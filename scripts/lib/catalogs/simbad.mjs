// SIMBAD (https://simbad.cds.unistra.fr/, CDS, Strasbourg), for objects
// OpenNGC doesn't cover: stars and double stars, Barnard and Abell objects,
// Sharpless regions, open clusters outside NGC and IC. It's asked only when
// the sources before it don't know a designation, over the network, so each
// answer is cached in .catalog-cache/simbad/ and a failed request is a miss,
// not an error.
//
// sim-id resolves a designation the way SIMBAD's search box does (Albireo,
// beta Cyg, Abell 426, Sh2-155); its TAP service then gives the object's
// data and other designations.
//
// A catalog source (see scripts/lib/catalog.mjs): its credit, and load(),
// which returns an async lookup(designation) -> entry or null.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { keyOf, normalize } from "./common.mjs";

const BASE = "https://simbad.cds.unistra.fr/simbad";
const CACHE = join(".catalog-cache", "simbad");
const TIMEOUT = 20_000;

// Prefixes SIMBAD reads differently: B 33 is Barnard 33 to an observer,
// but ambiguous to SIMBAD.
const SPELLED = { B: "Barnard" };

function spelled(id) {
  const n = normalize(id);
  const m = n?.match(/^([A-Za-z]+) (.*)$/);
  return m && SPELLED[m[1]] ? `${SPELLED[m[1]]} ${m[2]}` : String(id).trim();
}

// The first row of a VOTable, as { field: value }.
function firstRow(xml) {
  const fields = [...xml.matchAll(/<FIELD[^>]*\bname="([^"]+)"/g)].map((m) => m[1]);
  const row = xml.match(/<TR>([\s\S]*?)<\/TR>/);
  if (!row) return null;
  const cells = [...row[1].matchAll(/<TD>([^<]*)<\/TD>|<TD\/>/g)].map((m) => m[1] ?? "");
  const unescape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  return Object.fromEntries(fields.map((f, i) => [f, unescape(cells[i] ?? "")]));
}

async function get(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`SIMBAD: ${res.status} ${res.statusText}`);
  return res.text();
}

// SIMBAD's main identifier for a designation, or null when it doesn't know
// it or it's ambiguous.
async function resolve(id) {
  const xml = await get(`${BASE}/sim-id?${new URLSearchParams({ Ident: spelled(id), "output.format": "VOTable", "output.max": "1" })}`);
  return firstRow(xml)?.MAIN_ID || null;
}

async function tap(query) {
  const res = await fetch(`${BASE}/sim-tap/sync`, {
    method: "POST",
    body: new URLSearchParams({ REQUEST: "doQuery", LANG: "ADQL", FORMAT: "json", QUERY: query }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`SIMBAD TAP: ${res.status} ${res.statusText}`);
  const { metadata, data } = await res.json();
  return data.map((row) => Object.fromEntries(metadata.map((m, i) => [m.name, row[i]])));
}

const quote = (s) => `'${s.replace(/'/g, "''")}'`;

// Sexagesimal like OpenNGC's: RA "16:41:41.63", Dec "+36:27:40.7".
function sexagesimal(value, hours) {
  const sign = value < 0 ? "-" : hours ? "" : "+";
  let v = Math.abs(hours ? value / 15 : value);
  const d = Math.floor(v);
  v = (v - d) * 60;
  const m = Math.floor(v);
  const s = (v - m) * 60;
  const pad = (n, w) => String(n).padStart(w, "0");
  const sec = hours ? s.toFixed(2).padStart(5, "0") : s.toFixed(1).padStart(4, "0");
  return `${sign}${pad(d, 2)}:${pad(m, 2)}:${sec}`;
}

const arcmin = (x) => (x >= 10 ? Math.round(x) : Math.round(x * 10) / 10);

// The entry for SIMBAD's object `main`, looked up as `id`.
async function entry(id, main) {
  const [b] = await tap(`SELECT b.oid, b.otype, d.description, b.ra, b.dec, b.galdim_majaxis, b.galdim_minaxis, f.V, f.B
    FROM basic AS b LEFT JOIN allfluxes AS f ON f.oidref = b.oid LEFT JOIN otypedef AS d ON d.otype = b.otype
    WHERE b.main_id = ${quote(main)}`);
  if (!b) return null;
  const idents = (await tap(`SELECT id FROM ident WHERE oidref = ${Number(b.oid)}`)).map((r) => r.id.replace(/\s+/g, " ").trim());
  // The catalogs observers use; an object in none of them goes by the
  // designation it was looked up as, as written.
  const catalog = idents.map((x) => x.match(/^(M|NGC|IC) (\d+[A-Z]?)$/)).filter(Boolean).map((m) => normalize(m[1] + m[2]));
  const asWritten = String(id).trim().replace(/\s+/g, " ");
  // Common names, the one it was looked up by first (SIMBAD lists Albireo
  // after the misspelling Albereo).
  const names = idents.filter((x) => x.startsWith("NAME ")).map((x) => x.slice(5))
    .sort((a, b) => (b.toLowerCase() === asWritten.toLowerCase()) - (a.toLowerCase() === asWritten.toLowerCase()));
  const [maj, min] = [b.galdim_majaxis, b.galdim_minaxis].map((x) => (x == null ? null : arcmin(x)));
  const mag = b.V ?? b.B;
  return {
    ids: catalog.length ? [...new Set(catalog)] : [asWritten],
    name: names[0] ?? null,
    ...(names.length > 1 ? { names } : {}),
    type: b.description ?? b.otype,
    constellation: null,
    magnitude: mag == null ? null : Math.round(mag * 10) / 10,
    size: maj == null ? null : min == null ? `${maj}′` : `${maj}′ × ${min}′`,
    ra: b.ra == null ? null : sexagesimal(b.ra, true),
    dec: b.dec == null ? null : sexagesimal(b.dec, false),
  };
}

export const simbad = {
  name: "SIMBAD",
  by: "CDS, Strasbourg",
  version: null,
  url: "https://simbad.cds.unistra.fr/",
  license: null,
  async load() {
    await mkdir(CACHE, { recursive: true });
    return async (id) => {
      const path = join(CACHE, `${encodeURIComponent(keyOf(id))}.json`);
      if (existsSync(path)) return JSON.parse(await readFile(path, "utf8"));
      let found = null;
      try {
        const main = await resolve(id);
        found = main && await entry(id, main);
      } catch (err) {
        console.warn(`SIMBAD lookup of ${id} skipped: ${err.message}`);
        return null;
      }
      await writeFile(path, JSON.stringify(found));
      return found;
    };
  },
};
