// OpenNGC (https://github.com/mattiaverga/OpenNGC, CC-BY-SA 4.0): every
// designation, common names and object data for NGC, IC and Messier objects
// and the addendum's extras (Caldwell, Melotte, ...). The CSVs are fetched
// once at a pinned release into .catalog-cache/.
//
// A catalog source (see scripts/lib/catalog.mjs): its credit, and load(),
// which returns an async lookup(designation) -> entry or null.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CONSTELLATIONS, keyOf, normalize } from "./common.mjs";

const VERSION = "v20260501";
const FILES = ["NGC.csv", "addendum.csv"];
const CACHE = ".catalog-cache";

const TYPES = {
  "*": "Star", "**": "Double star", "*Ass": "Association of stars", OCl: "Open cluster",
  GCl: "Globular cluster", "Cl+N": "Star cluster with nebula", G: "Galaxy", GPair: "Galaxy pair",
  GTrpl: "Galaxy triplet", GGroup: "Group of galaxies", PN: "Planetary nebula", HII: "HII region",
  DrkN: "Dark nebula", EmN: "Emission nebula", Neb: "Nebula", RfN: "Reflection nebula",
  SNR: "Supernova remnant", Nova: "Nova star", NonEx: "Nonexistent object", Other: "Other",
};

async function csv(file) {
  const path = join(CACHE, VERSION, file);
  if (!existsSync(path)) {
    const res = await fetch(`https://raw.githubusercontent.com/mattiaverga/OpenNGC/${VERSION}/database_files/${file}`);
    if (!res.ok) throw new Error(`OpenNGC ${file}: ${res.status} ${res.statusText}`);
    await mkdir(join(CACHE, VERSION), { recursive: true });
    await writeFile(path, await res.text());
  }
  const [header, ...lines] = (await readFile(path, "utf8")).trim().split(/\r?\n/);
  const cols = header.split(";");
  return lines.map((line) => Object.fromEntries(line.split(";").map((v, i) => [cols[i], v])));
}

const list = (s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);
const num = (s) => (s === "" || s == null ? null : Number(s));

// One object's reference data, keyed later by its first designation, and
// the other catalog numbers it can be found by.
function entry(row) {
  const ids = [];
  const own = normalize(row.Name) ?? row.Name;
  if (row.M) ids.push(normalize(`M${row.M}`));
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

export const openngc = {
  name: "OpenNGC",
  version: VERSION,
  url: "https://github.com/mattiaverga/OpenNGC",
  license: "CC BY-SA 4.0",
  async load() {
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
    return async (id) => byId.get(keyOf(id)) ?? null;
  },
};
