// Validate every notebook and session file against its schema, and check
// that notebook pages are in category order (data/categories.json) and that
// sessions point at notebook pages that exist.
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { orderErrors } from "./lib/categories.mjs";

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

async function compile(name) {
  return ajv.compile(JSON.parse(await readFile(`schema/${name}.schema.json`, "utf8")));
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

const notebooks = await load("data/notebooks", await compile("notebook"));
const sessions = await load("data/sessions", await compile("session"));

for (const { path, data: nb } of notebooks.values()) {
  const errors = orderErrors(nb.pages);
  if (nb.front_cover && !existsSync(join("scans", nb.id, "cover-front.jpg"))) {
    errors.push(`/front_cover has no image at scans/${nb.id}/cover-front.jpg`);
  }
  nb.pages.forEach((_, i) => {
    const image = join("scans", nb.id, `${String(i + 1).padStart(2, "0")}.jpg`);
    if (!existsSync(image)) errors.push(`/pages/${i} has no image at ${image}`);
  });
  report(path, errors);
}

for (const { path, data: s } of sessions.values()) {
  const errors = [];
  if (s.notebook) {
    const nb = notebooks.get(s.notebook)?.data;
    if (!nb) {
      errors.push(`/notebook "${s.notebook}" has no valid data/notebooks/${s.notebook}.json`);
    } else {
      const numbers = new Set(nb.pages.map((p) => p.number).filter(Boolean));
      for (const n of s.pages ?? []) {
        if (!numbers.has(n)) errors.push(`/pages: ${s.notebook} has no page ${n}`);
      }
    }
  }
  s.observations.forEach((o, i) => {
    if (o.page != null && !(s.pages ?? []).includes(o.page)) {
      errors.push(`/observations/${i}/page ${o.page} is not in the session's pages`);
    }
  });
  report(path, errors);
}

// Catalog info (scripts/enrich-ids.mjs): schema, and each object is keyed
// by its first designation.
const objectsPath = join("data", "objects.json");
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

console.log(`${notebooks.size} notebooks, ${sessions.size} sessions; ${failed ? `${failed} problem files` : "all valid"}`);
process.exit(failed ? 1 : 0);
