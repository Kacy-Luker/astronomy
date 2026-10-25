// Catalog lookup from OpenNGC (https://github.com/mattiaverga/OpenNGC,
// CC-BY-SA 4.0): every designation, common names and object data for NGC,
// IC and Messier objects and the addendum's extras (Caldwell, Melotte, ...).
// The CSVs are fetched once at a pinned release into .catalog-cache/.
//
// ids hold the catalogs observers use: Messier, NGC, IC and Caldwell. Other
// numbers OpenNGC lists (UGC, PGC, LBN, MWSC, ...) only help find an object.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compareIds } from "../../site/catalog.js";

export const OPENNGC = {
  version: "v20260501",
  url: "https://github.com/mattiaverga/OpenNGC",
  license: "CC-BY-SA-4.0",
};
const FILES = ["NGC.csv", "addendum.csv"];
const CACHE = ".catalog-cache";

const TYPES = {
  "*": "Star", "**": "Double star", "*Ass": "Association of stars", OCl: "Open cluster",
  GCl: "Globular cluster", "Cl+N": "Star cluster with nebula", G: "Galaxy", GPair: "Galaxy pair",
  GTrpl: "Galaxy triplet", GGroup: "Group of galaxies", PN: "Planetary nebula", HII: "HII region",
  DrkN: "Dark nebula", EmN: "Emission nebula", Neb: "Nebula", RfN: "Reflection nebula",
  SNR: "Supernova remnant", Nova: "Nova star", NonEx: "Nonexistent object", Other: "Other",
};

const CONSTELLATIONS = Object.fromEntries(`And Andromeda|Ant Antlia|Aps Apus|Aqr Aquarius|Aql Aquila|Ara Ara|Ari Aries|Aur Auriga|Boo Boötes|Cae Caelum|Cam Camelopardalis|Cnc Cancer|CVn Canes Venatici|CMa Canis Major|CMi Canis Minor|Cap Capricornus|Car Carina|Cas Cassiopeia|Cen Centaurus|Cep Cepheus|Cet Cetus|Cha Chamaeleon|Cir Circinus|Col Columba|Com Coma Berenices|CrA Corona Australis|CrB Corona Borealis|Crv Corvus|Crt Crater|Cru Crux|Cyg Cygnus|Del Delphinus|Dor Dorado|Dra Draco|Equ Equuleus|Eri Eridanus|For Fornax|Gem Gemini|Gru Grus|Her Hercules|Hor Horologium|Hya Hydra|Hyi Hydrus|Ind Indus|Lac Lacerta|Leo Leo|LMi Leo Minor|Lep Lepus|Lib Libra|Lup Lupus|Lyn Lynx|Lyr Lyra|Men Mensa|Mic Microscopium|Mon Monoceros|Mus Musca|Nor Norma|Oct Octans|Oph Ophiuchus|Ori Orion|Pav Pavo|Peg Pegasus|Per Perseus|Phe Phoenix|Pic Pictor|Psc Pisces|PsA Piscis Austrinus|Pup Puppis|Pyx Pyxis|Ret Reticulum|Sge Sagitta|Sgr Sagittarius|Sco Scorpius|Scl Sculptor|Sct Scutum|Ser Serpens|Sex Sextans|Tau Taurus|Tel Telescopium|Tri Triangulum|TrA Triangulum Australe|Tuc Tucana|UMa Ursa Major|UMi Ursa Minor|Vel Vela|Vir Virgo|Vol Volans|Vul Vulpecula`
  .split("|").map((s) => [s.slice(0, s.indexOf(" ")), s.slice(s.indexOf(" ") + 1)]));

const ALIASES = { MESSIER: "M", CALDWELL: "C", MELOTTE: "MEL", COLLINDER: "CR" };
const PREFIXES = { M: "M", NGC: "NGC", IC: "IC", C: "C", MEL: "Mel", CR: "Cr", B: "B", H: "H" };

// "m 31", "Messier31", "NGC0224", "ngc 224" -> "M31", "NGC 224". Messier
// keeps no space, as written in the notebook; other catalogs get one. Null
// for anything that isn't a catalog designation.
export function normalize(id) {
  const m = String(id).trim().toUpperCase().replace(/\s+/g, "")
    .match(/^([A-Z]+?)0*(\d+)([A-Z]?)(-\d+)?$/);
  if (!m) return null;
  const letters = ALIASES[m[1]] ?? m[1];
  const prefix = PREFIXES[letters] ?? letters;
  return `${prefix}${prefix === "M" ? "" : " "}${Number(m[2])}${m[3]}${m[4] ?? ""}`;
}

async function csv(file) {
  const path = join(CACHE, OPENNGC.version, file);
  if (!existsSync(path)) {
    const res = await fetch(`https://raw.githubusercontent.com/mattiaverga/OpenNGC/${OPENNGC.version}/database_files/${file}`);
    if (!res.ok) throw new Error(`OpenNGC ${file}: ${res.status} ${res.statusText}`);
    await mkdir(join(CACHE, OPENNGC.version), { recursive: true });
    await writeFile(path, await res.text());
  }
  const [header, ...lines] = (await readFile(path, "utf8")).trim().split(/\r?\n/);
  const cols = header.split(";");
  return lines.map((line) => Object.fromEntries(line.split(";").map((v, i) => [cols[i], v])));
}

const list = (s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);
const num = (s) => (s === "" || s == null ? null : Number(s));

// Where we follow observing programs rather than OpenNGC. M102 is listed
// there as a duplicate of M101; the Astronomical League's Messier program
// and most lists take it as NGC 5866, the Spindle Galaxy.
const MESSIER = { "NGC 5866": "M102" };

// Lookup key for any designation, including ones normalize() doesn't parse
// (e.g. "2MASX J00424433+4116074").
const keyOf = (id) => normalize(id) ?? String(id).toUpperCase().replace(/\s+/g, "");

// One object's reference data, keyed later by its first designation, and
// the other catalog numbers it can be found by.
function entry(row) {
  const ids = [];
  const own = normalize(row.Name) ?? row.Name;
  const messier = row.M ? normalize(`M${row.M}`) : MESSIER[own];
  if (messier) ids.push(messier);
  ids.push(own);
  for (const n of list(row.NGC)) ids.push(normalize(`NGC${n}`));
  for (const n of list(row.IC)) ids.push(normalize(`IC${n}`));
  const others = list(row.Identifiers);
  for (const x of others.filter((x) => /^C \d+$/.test(x))) ids.push(normalize(x.replace(" ", "")));
  const names = list(row["Common names"]);
  // Sizes in arcminutes, whole above 10′; magnitudes to one decimal.
  const arcmin = (x) => (x >= 10 ? Math.round(x) : Math.round(x * 10) / 10);
  const [maj, min] = [num(row.MajAx), num(row.MinAx)].map((x) => (x == null ? null : arcmin(x)));
  const mag = num(row["V-Mag"]) ?? num(row["B-Mag"]);
  const e = {
    ids: [...new Set(ids)],
    name: names[0] ?? null,
    ...(names.length > 1 ? { names } : {}),
    type: TYPES[row.Type] ?? row.Type,
    constellation: CONSTELLATIONS[row.Const] ?? (row.Const || null),
    magnitude: mag == null ? null : Math.round(mag * 10) / 10,
    size: maj == null ? null : min == null ? `${maj}′` : `${maj}′ × ${min}′`,
    ra: row.RA || null,
    dec: row.Dec || null,
  };
  return { e, aliases: others.map(keyOf) };
}

// Loads the catalog; returns lookup(designation) -> entry or null.
export async function loadCatalog() {
  const rows = (await Promise.all(FILES.map(csv))).flat();
  const byId = new Map();
  const dups = [];
  const aliases = [];
  const entries = [];
  for (const row of rows) {
    if (row.Type === "Dup") { dups.push(row); continue; }
    const { e, aliases: more } = entry(row);
    entries.push(e);
    for (const a of more) aliases.push([a, e]);
  }
  // Each object's own name and Messier number first, then the designations
  // it shares with others (pairs list each other's NGC numbers).
  for (const e of entries) for (const id of e.ids.slice(0, e.ids[0].startsWith("M") ? 2 : 1)) byId.set(id, e);
  for (const e of entries) for (const id of e.ids) if (!byId.has(id)) byId.set(id, e);
  // A duplicate entry points at the real object through its M, NGC or IC column.
  for (const row of dups) {
    const target = [row.M && `M${row.M}`, ...list(row.NGC).map((n) => `NGC${n}`), ...list(row.IC).map((n) => `IC${n}`)]
      .map((t) => t && byId.get(normalize(t))).find(Boolean);
    const own = normalize(row.Name);
    if (target && own && !byId.has(own)) byId.set(own, target);
  }
  // Other catalog numbers find an object but never take over a designation.
  for (const [a, e] of aliases) if (!byId.has(a)) byId.set(a, e);
  return (id) => byId.get(keyOf(id)) ?? null;
}

// Adds every known designation to each observation's ids (keeping what's
// there, written ones first) and collects the reference data for every
// observed object. aka is left as written. Returns the objects, keyed by
// each object's first designation in catalog order, and the ids of the
// sessions that changed.
export function enrichSessions(sessions, lookup) {
  const objects = {};
  const changed = new Set();
  for (const s of sessions) {
    for (const o of s.observations ?? []) {
      const found = lookup(o.catalog_id);
      if (!found) continue;
      const before = o.ids ?? [o.catalog_id];
      const ids = [...new Set([...before, ...found.ids])];
      if (ids.length !== before.length || !o.ids) { o.ids = ids; changed.add(s.id); }
      objects[found.ids[0]] = found;
    }
  }
  const sorted = Object.fromEntries(Object.keys(objects).sort(compareIds).map((k) => [k, objects[k]]));
  return { objects: sorted, changed };
}

// The data/objects.json document: the objects plus where they came from.
export const objectsFile = (objects) => ({
  source: `OpenNGC ${OPENNGC.version}, ${OPENNGC.url}`,
  license: OPENNGC.license,
  objects,
});
