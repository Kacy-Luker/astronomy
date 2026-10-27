// The page reader the import uses (docs/DEPENDENCIES.md): PAGE_READER names
// a built-in reader (claude, the default) or a module path. A reader exports
// readPage(image, { form }) and checkRedaction(image), taking a page as a
// JPEG buffer (form is what the notebook is written on, "stamped" or "free",
// from data/notebook-types.json) and answering in the format of scripts/lib/reading.mjs; every answer is
// checked against it here, so a replacement can't slip in another shape.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PageReading, RedactionCheck } from "./reading.mjs";
import { check } from "./schema.mjs";

const BUILT_IN = { claude: "./readers/claude.mjs" };

export async function loadReader(choice = process.env.PAGE_READER || "claude") {
  const reader = await import(BUILT_IN[choice] ?? pathToFileURL(resolve(choice)).href);
  for (const fn of ["readPage", "checkRedaction"]) {
    if (typeof reader[fn] !== "function") throw new Error(`the page reader "${choice}" has no ${fn}()`);
  }
  const held = (fn, format) => async (image, context) => {
    const answer = check(format, await reader[fn](image, context));
    if (!answer.ok) throw new Error(`the page reader "${choice}" answered ${fn}() in the wrong format: ${answer.problem}`);
    return answer.data;
  };
  return {
    name: reader.name ?? choice,
    readPage: held("readPage", PageReading),
    checkRedaction: held("checkRedaction", RedactionCheck),
  };
}
