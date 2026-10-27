// Reading and writing the data files (data/, test-data/) and naming page
// images, the same way in every script (#27). JSON is written laid out for
// hand editing (format-json.mjs), with a final newline.
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatJSON } from "./format-json.mjs";

// A JSON file; fallback when it doesn't exist (an error without one).
export async function readJSON(path, fallback) {
  if (fallback !== undefined && !existsSync(path)) return fallback;
  return JSON.parse(await readFile(path, "utf8"));
}

// Every .json file in dir, by file name, as { path, data }; none when dir
// doesn't exist.
export async function readJSONDir(dir) {
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  return Promise.all(files.map(async (f) => ({ path: join(dir, f), data: await readJSON(join(dir, f)) })));
}

export const writeJSON = (path, value) => writeFile(path, formatJSON(value) + "\n");

// The page at index (from 0) is NN.jpg, from 01.
export const pageName = (index) => String(index + 1).padStart(2, "0");

// Which object in data/objects.json an observation is of: its key there,
// found by the observation's designation or any of its ids, else null.
export function objectKeys(objects) {
  const keyOf = new Map(Object.entries(objects).flatMap(([key, o]) => o.ids.map((x) => [x, key])));
  return (o) => [o.catalog_id, ...(o.ids ?? [])].map((x) => keyOf.get(x)).find(Boolean) ?? null;
}
