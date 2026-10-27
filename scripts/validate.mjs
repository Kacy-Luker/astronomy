// Validate every notebook and session file (data/ and test-data/) against
// its schema, and check that notebook pages are in category order
// (data/categories.json) and that sessions point at notebook pages that
// exist.
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { designation } from "./lib/catalogs/common.mjs";
import { orderErrors } from "./lib/categories.mjs";

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

// Each schema is compiled once, however many datasets use it.
const compiled = new Map();
async function compile(name) {
  if (!compiled.has(name)) compiled.set(name, ajv.compile(JSON.parse(await readFile(`schema/${name}.schema.json`, "utf8"))));
  return compiled.get(name);
}

let checked = 0;
let failed = 0;
function report(path, errors) {
  checked++;
  if (!errors.length) return;
  failed++;
  for (const e of errors) console.error(`${path}: ${e}`);
}

// Parse and schema-check each file in dir; returns the valid ones by id.
async function load(dir, validate) {
  const byId = new Map();
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json"))) {
    const path = join(dir, file);
    const errors = [];
    let data;
    try {
      data = JSON.parse(await readFile(path, "utf8"));
    } catch (err) {
      report(path, [`invalid JSON: ${err.message}`]);
      continue;
    }
    if (!validate(data)) {
      for (const e of validate.errors) errors.push(`${e.instancePath || "/"} ${e.message}`);
    }
    if (data.id !== basename(file, ".json")) {
      errors.push(`/id must match the file name (${basename(file, ".json")})`);
    }
    if (errors.length) report(path, errors);
    else byId.set(data.id, { path, data });
  }
  return byId;
}

// The kinds of notebook (#48): schema, and each id once. Notebooks name one.
const typesPath = join("data", "notebook-types.json");
const typeIds = new Set();
{
  const validate = await compile("notebook-types");
  let doc;
  try {
    doc = JSON.parse(await readFile(typesPath, "utf8"));
  } catch (err) {
    report(typesPath, [`invalid JSON: ${err.message}`]);
  }
  if (doc && !validate(doc)) report(typesPath, validate.errors.map((e) => `${e.instancePath || "/"} ${e.message}`));
  else if (doc) {
    const errors = [];
    doc.types.forEach((t, i) => {
      if (typeIds.has(t.id)) errors.push(`/types/${i}: ${t.id} is listed more than once`);
      typeIds.add(t.id);
    });
    report(typesPath, errors);
  }
}

// The real data, and the test site's made-up data (test-data/, #64), which
// is checked the same way.
const DATASETS = [{ data: "data", scans: "scans" }, { data: "test-data", scans: "test-data/scans" }]
  .filter((d) => existsSync(d.data));
let notebookCount = 0;
let sessionCount = 0;
for (const { data: DATA, scans: SCANS } of DATASETS) {
  const notebooks = await load(join(DATA, "notebooks"), await compile("notebook"));
  const sessions = await load(join(DATA, "sessions"), await compile("session"));

  for (const { path, data: nb } of notebooks.values()) {
    const errors = orderErrors(nb.pages);
    if (nb.type && !typeIds.has(nb.type)) errors.push(`/type ${nb.type} isn't in ${typesPath}`);
    if (nb.front_cover && !existsSync(join(SCANS, nb.id, "cover-front.jpg"))) {
      errors.push(`/front_cover has no image at ${SCANS}/${nb.id}/cover-front.jpg`);
    }
    nb.pages.forEach((_, i) => {
      const image = join(SCANS, nb.id, `${String(i + 1).padStart(2, "0")}.jpg`);
      if (!existsSync(image)) errors.push(`/pages/${i} has no image at ${image}`);
    });
    report(path, errors);
  }

  for (const { path, data: s } of sessions.values()) {
    const errors = [];
    if (s.notebook) {
      const nb = notebooks.get(s.notebook)?.data;
      if (!nb) {
        errors.push(`/notebook "${s.notebook}" has no valid ${DATA}/notebooks/${s.notebook}.json`);
      } else {
        const numbers = new Set(nb.pages.map((p) => p.number).filter(Boolean));
        for (const n of s.pages ?? []) {
          if (!numbers.has(n)) errors.push(`/pages: ${s.notebook} has no page ${n}`);
        }
      }
    }
    if (s.header_box && !(s.pages ?? []).includes(s.header_box.page)) {
      errors.push(`/header_box/page ${s.header_box.page} is not in the session's pages`);
    }
    s.observations.forEach((o, i) => {
      if (o.page != null && !(s.pages ?? []).includes(o.page)) {
        errors.push(`/observations/${i}/page ${o.page} is not in the session's pages`);
      }
      if (o.box && o.page == null) errors.push(`/observations/${i}/box needs the entry's page`);
      if (o.box && (o.box[0] + o.box[2] > 1.001 || o.box[1] + o.box[3] > 1.001)) {
        errors.push(`/observations/${i}/box runs off the page`);
      }
      // An entry comes after its own session's NEW SESSION block, so its
      // sketch is paired with the right block even when one page holds two
      // sessions (site/cards.js).
      const hb = s.header_box;
      if (hb && o.page != null && (o.page < hb.page || (o.page === hb.page && o.box && hb.box &&
        o.box[1] < hb.box[1] + hb.box[3] - 0.02))) {
        errors.push(`/observations/${i} comes before its session's NEW SESSION block (header_box)`);
      }
    });
    report(path, errors);
  }

  // Catalog info (scripts/enrich-ids.mjs): schema, and each object is keyed
  // by its first designation.
  const objectsPath = join(DATA, "objects.json");
  if (existsSync(objectsPath)) {
    const validate = await compile("objects");
    let doc;
    try {
      doc = JSON.parse(await readFile(objectsPath, "utf8"));
    } catch (err) {
      report(objectsPath, [`invalid JSON: ${err.message}`]);
    }
    if (doc && !validate(doc)) report(objectsPath, validate.errors.map((e) => `${e.instancePath || "/"} ${e.message}`));
    else if (doc) {
      report(objectsPath, Object.entries(doc.objects).filter(([k, o]) => o.ids[0] !== k).map(([k]) => `/objects/${k} must be keyed by its first id`));
    }
  }

  // Favorites (scripts/favorite.mjs): at most one per object, matched through
  // data/objects.json so M31 and NGC 224 are one.
  {
    const objectsDoc = existsSync(objectsPath) ? JSON.parse(await readFile(objectsPath, "utf8")) : { objects: {} };
    const keyOf = new Map(Object.entries(objectsDoc.objects).flatMap(([key, o]) => o.ids.map((x) => [x, key])));
    const favorites = new Map();
    for (const { path, data: s } of sessions.values()) {
      for (const o of s.observations ?? []) {
        if (!o.favorite) continue;
        const key = [o.catalog_id, ...(o.ids ?? [])].map((x) => keyOf.get(x)).find(Boolean) ?? o.catalog_id;
        favorites.set(key, [...(favorites.get(key) ?? []), `${path} (${o.catalog_id})`]);
      }
    }
    for (const [key, where] of favorites) {
      if (where.length > 1) report(join(DATA, "sessions"), [`${key} has ${where.length} favorites; keep one: ${where.join(", ")}`]);
    }
  }
  notebookCount += notebooks.size;
  sessionCount += sessions.size;
}

// Kacy's catalog mappings: schema, each side a designation, and each
// object mapped once.
const mappingsPath = join("data", "personalObjectMappings.json");
if (existsSync(mappingsPath)) {
  const validate = await compile("personal-object-mappings");
  let doc;
  try {
    doc = JSON.parse(await readFile(mappingsPath, "utf8"));
  } catch (err) {
    report(mappingsPath, [`invalid JSON: ${err.message}`]);
  }
  if (doc && !validate(doc)) report(mappingsPath, validate.errors.map((e) => `${e.instancePath || "/"} ${e.message}`));
  else if (doc) {
    const errors = [];
    const seen = new Set();
    doc.mappings.forEach((m, i) => {
      const [from, to] = [m.from, m.to].map(designation);
      if (!from) errors.push(`/mappings/${i}/from isn't a catalog designation`);
      if (!to) errors.push(`/mappings/${i}/to isn't a catalog designation`);
      if (from && from === to) errors.push(`/mappings/${i} maps ${from} to itself`);
      if (from && seen.has(from)) errors.push(`/mappings/${i}: ${from} is mapped more than once`);
      seen.add(from);
    });
    report(mappingsPath, errors);
  }
}

console.log(`${notebookCount} notebooks, ${sessionCount} sessions; ${failed ? `${failed} problem files` : "all valid"}`);
process.exit(failed ? 1 : 0);
