// Pick the notebook and scan for a Notebook job run (the scan source,
// scripts/lib/scans.mjs), from the form: MODE, PICKED (the notebook, or
// new-notebook) and SCAN (a path in astronomy-scans, or empty for the
// newest), with the uploads fetched to .scans/. Writes NOTEBOOK, SCAN and
// BRANCH to $GITHUB_ENV (or prints them), or stops with the problem.
import { appendFileSync, existsSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { pickScan, sniff } from "./lib/scans.mjs";

const STORE = ".scans";
const { MODE: mode, PICKED: picked, SCAN: asked = "" } = process.env;
let notebook, scan;
try {
  ({ notebook, scan } = pickScan({
    store: STORE, mode, picked, scan: asked, hasNotebook: (id) => existsSync(join("data", "notebooks", `${id}.json`)),
  }));
} catch (err) {
  console.log(`::error::${err.message}`);
  process.exit(1);
}
if (scan) console.log(`Importing ${scan}: ${await sniff(join(STORE, scan))}, ${statSync(join(STORE, scan)).size} bytes`);
const name = basename(scan ?? "completed").replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9.-]/g, "-");
const lines = [`NOTEBOOK=${notebook}`, `SCAN=${scan ?? ""}`, `BRANCH=import/${notebook}-${mode}-${name}`];
if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, lines.join("\n") + "\n");
else console.log(lines.join("\n"));
