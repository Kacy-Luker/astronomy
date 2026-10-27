// The page reader that asks Claude (docs/DEPENDENCIES.md): one notebook
// page image in, its reading out, in the format of scripts/lib/reading.mjs.
// The model, effort and refusal fallback are set here and nowhere else.
import Anthropic from "@anthropic-ai/sdk";
import { CATEGORIES } from "../categories.mjs";
import { PageReading, RedactionCheck } from "../reading.mjs";
import { asJSONSchema, check } from "../schema.mjs";

export const name = "claude";
const MODEL = "claude-opus-5-5";

// What the pages are written on (form in data/notebook-types.json); system()
// is the instructions for one.
const FORMS = {
  stamped: `The notebook uses a printed log sheet. A session starts with a NEW SESSION block:
PROGRAM, DATE, SITE, LAT/LONG, SKY/SQM, SCOPE, OBSERVER. Each object entry has
CAT #, AKA, LT (local time), UT, SEE I-V and TR I-V (the observer circles one
numeral each), EP/MAG (eyepiece and magnification), FILTER, a sketch circle, and
DESCRIPTION lines that often run past the printed lines.`,
  free: `The notebook has no printed form: it's written in free text. A session starts
at a date heading, usually followed by where, the sky and the telescope; give
those as "header" (the format's NEW SESSION block), with its box around the
heading and those lines. Each object written about after it is an entry: pick
out its catalog designation, any other name, the times, seeing, transparency,
eyepiece, magnification and filter where the text gives them, and the rest of
what's written about it as the description. Its box covers all the writing for
that object and any sketch beside it. Seeing and transparency are 1-5 only when
written as a numeral (I-V or 1-5); words like "good" stay in the description
and the field is null. A field the text doesn't give is null, never inferred
from other entries or the session.`,
};

export const system = (form) => `You transcribe pages from a handwritten astronomy observing notebook.

${FORMS[form] ?? FORMS.stamped}

Each page is in one category ("kind"), in the order they come in the notebook:
${CATEGORIES.map((c) => `- ${c.kind}: ${c.describe}`).join("\n")}
- unused: a session page whose only entries are crossed out or never filled in.
- blank: nothing written or printed on it, including the scanner's lid beside
  the closed notebook's front cover.
Odd pages carry a small printed page number in the top outer corner.

Rules:
- Transcribe what is written. Do not add facts, cross-catalog IDs, or names that
  aren't on the page. Leave a field null when it's blank.
- Skip an entry that is crossed out. Leave out individual struck-through words.
- Join description lines into one string; use "; " where the writer used ";".
- Where the writer wrote N/A, use the string "N/A": the field doesn't apply.
  null means the field is blank, which the writer will come back to; keep
  the two apart. Dates as YYYY-MM-DD (the writer uses MM/DD/YYYY). Times as
  HH:MM.
- SCOPE like "Orion XT8; DOB 203mm, FL 1200mm, f5.9" becomes name "Orion XT8",
  type "Dobsonian", aperture 203, focal length 1200, f-ratio 5.9.
- SQM like "~21.99 mag/arcsec^2" is 21.99.
- EP/MAG is two fields: eyepiece like "13mm Ethos", then magnification after
  the ";" (e.g. "13mm Ethos; 92x" is 92). With nothing after the ";" the
  magnification is blank (null); the writer fills it in later.
- will_change is true for a table of contents or index with empty rows left,
  and a session page with unused space below its last entry where another
  entry could still go. Otherwise false.
- personal_info boxes must fully cover each item with a little margin.
- The header and entry boxes are used to cut out each sketch: include the
  whole block with a little margin, and never cut through writing.
- List anything you had to guess in "uncertain".`;

// Made on first use, so loading the reader needs no API key.
let client;

// The first {...} block in a reply, parsed; null when there isn't valid JSON.
export function extractJSON(text) {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

// The answer format is given as a JSON Schema in the prompt and checked here.
// (Enforcing it in the API instead fails: the schema is too large to compile.)
// A reply that doesn't fit goes back once with what was wrong.
async function ask(image, prompt, schema, maxTokens, form) {
  const format = JSON.stringify(asJSONSchema(schema));
  const messages = [{
    role: "user",
    content: [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image.toString("base64") } },
      { type: "text", text: `${prompt}\n\nReply with only a JSON object matching this JSON Schema, and nothing else:\n${format}` },
    ],
  }];
  for (let attempt = 1; ; attempt++) {
    client ??= new Anthropic();
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "high" },
      system: system(form),
      messages,
    });
    if (response.stop_reason === "refusal") {
      throw new Error(`refused (${response.stop_details?.category ?? "no category"})`);
    }
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const json = extractJSON(text);
    const result = json ? check(schema, json) : null;
    if (result?.ok) return result.data;
    const problem = result ? result.problem : "the reply had no valid JSON object";
    if (attempt === 2) throw new Error(`Claude's reply didn't match the page format: ${problem}`);
    messages.push(
      { role: "assistant", content: response.content },
      { role: "user", content: `That doesn't match the format: ${problem}\nReply with only the corrected JSON object.` },
    );
  }
}

// form is what the notebook is written on: "stamped" (the default) or "free".
export function readPage(image, { form = "stamped" } = {}) {
  return ask(image, "Transcribe this notebook page.", PageReading, 16000, form);
}

// Second look at a page after blurring, so nothing private slips through.
export function checkRedaction(image) {
  return ask(image,
    "Some areas of this page were blurred to hide personal details. Can you still read " +
    "any phone number, email address, or street address anywhere on it?",
    RedactionCheck, 4000);
}
