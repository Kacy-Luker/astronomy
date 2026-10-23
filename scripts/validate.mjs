// Validate every session file against the schema.
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const SESSIONS = "data/sessions";

const schema = JSON.parse(await readFile("schema/session.schema.json", "utf8"));
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);

let failed = 0;
const files = (await readdir(SESSIONS)).filter((f) => f.endsWith(".json"));
for (const file of files) {
  const path = join(SESSIONS, file);
  let data;
  try {
    data = JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    console.error(`${path}: invalid JSON: ${err.message}`);
    failed++;
    continue;
  }
  const errors = [];
  if (!validate(data)) {
    for (const e of validate.errors) errors.push(`${e.instancePath || "/"} ${e.message}`);
  }
  if (data.id !== basename(file, ".json")) {
    errors.push(`/id must match the file name (${basename(file, ".json")})`);
  }
  if (errors.length) {
    failed++;
    for (const e of errors) console.error(`${path}: ${e}`);
  }
}

console.log(`${files.length - failed}/${files.length} session files valid`);
process.exit(failed ? 1 : 0);
