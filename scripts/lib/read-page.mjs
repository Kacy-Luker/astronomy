// Ask Claude to read one notebook page into structured data.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const MODEL = "claude-opus-5-5";

const Box = z.object({
  x: z.number().describe("Left edge, as a fraction of page width (0-1)"),
  y: z.number().describe("Top edge, as a fraction of page height (0-1)"),
  width: z.number(),
  height: z.number(),
});

const Scope = z.object({
  name: z.string(),
  type: z.string().nullable(),
  aperture_mm: z.number().nullable(),
  focal_length_mm: z.number().nullable(),
  f_ratio: z.number().nullable(),
});

const Scale = z.number().int().nullable().describe("Circled roman numeral as 1-5; null if none circled");

export const PageReading = z.object({
  kind: z.enum(["cover", "title", "index", "reference", "session", "unused", "blank", "contents", "info"]),
  printed_number: z.number().int().nullable()
    .describe("Page number printed in the top outer corner, if one is visible"),
  label: z.string().nullable()
    .describe("Short name for a page that isn't a session page, e.g. 'Volume label'"),
  will_change: z.boolean()
    .describe("True if more will be written on this page as the notebook fills"),
  notebook_label: z.object({
    title: z.string().nullable(),
    owner: z.string().nullable(),
    started: z.string().nullable().describe("YYYY-MM-DD"),
    finished: z.string().nullable().describe("YYYY-MM-DD"),
  }).nullable().describe("Only for the volume label or title page"),
  personal_info: z.array(z.object({ what: z.string(), box: Box }))
    .describe("Phone numbers, email addresses, and street addresses on the page"),
  header: z.object({
    program: z.string().nullable(),
    date: z.string().describe("YYYY-MM-DD"),
    site: z.string(),
    lat: z.number().nullable(),
    lon: z.number().nullable(),
    sqm: z.number().nullable(),
    sky_notes: z.string().nullable(),
    scope: Scope.nullable(),
    observers: z.array(z.string()),
  }).nullable().describe("The NEW SESSION block, if this page starts a session"),
  entries: z.array(z.object({
    catalog_id: z.string(),
    aka: z.string().nullable(),
    local_time: z.string().nullable().describe("HH:MM"),
    ut: z.string().nullable().describe("HH:MM"),
    seeing: Scale,
    transparency: Scale,
    eyepiece: z.string().nullable(),
    magnification: z.number().nullable(),
    filter: z.string().nullable(),
    description: z.string().nullable(),
  })).describe("Object entries in page order, skipping crossed-out entries"),
  uncertain: z.array(z.string())
    .describe("Readings you are unsure of, e.g. 'M110 description: last word may be dim'"),
});

const SYSTEM = `You transcribe pages from a handwritten astronomy observing notebook.

The notebook uses a printed log sheet. A session starts with a NEW SESSION block:
PROGRAM, DATE, SITE, LAT/LONG, SKY/SQM, SCOPE, OBSERVER. Each object entry has
CAT #, AKA, LT (local time), UT, SEE I-V and TR I-V (the observer circles one
numeral each), EP/MAG (eyepiece and magnification), FILTER, a sketch circle, and
DESCRIPTION lines that often run past the printed lines.

Front matter can include covers, a volume label (title, start and finish dates),
a title page with the owner's contact details, an index table, and a reference
key. Back matter can include a handwritten table of contents (kind "contents":
objects by catalog with their page numbers) and the notebook maker's info page
(kind "info": paper brand, page count, copyright). Odd pages carry a small
printed page number in the top outer corner.

Rules:
- Transcribe what is written. Do not add facts, cross-catalog IDs, or names that
  aren't on the page. Leave a field null when it's blank.
- Skip an entry that is crossed out. Leave out individual struck-through words.
- Join description lines into one string; use "; " where the writer used ";".
- "N/A" means null. Dates as YYYY-MM-DD (the writer uses MM/DD/YYYY). Times as HH:MM.
- SCOPE like "Orion XT8; DOB 203mm, FL 1200mm, f5.9" becomes name "Orion XT8",
  type "Dobsonian", aperture 203, focal length 1200, f-ratio 5.9.
- SQM like "~21.99 mag/arcsec^2" is 21.99.
- Eyepiece like "13mm Ethos;" with nothing after the ";" means no magnification.
- kind "unused" is a page whose only entries are crossed out or never filled in.
- will_change is true for an index with empty rows left, a volume label whose
  finish date is blank, and a session page with unused space below its last
  entry where another entry could still go. Otherwise false.
- personal_info boxes must fully cover each item with a little margin.
- List anything you had to guess in "uncertain".`;

const client = new Anthropic();

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
async function ask(image, prompt, schema, maxTokens) {
  const format = JSON.stringify(z.toJSONSchema(schema));
  const messages = [{
    role: "user",
    content: [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image.toString("base64") } },
      { type: "text", text: `${prompt}\n\nReply with only a JSON object matching this JSON Schema, and nothing else:\n${format}` },
    ],
  }];
  for (let attempt = 1; ; attempt++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "high" },
      system: SYSTEM,
      messages,
    });
    if (response.stop_reason === "refusal") {
      throw new Error(`refused (${response.stop_details?.category ?? "no category"})`);
    }
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const json = extractJSON(text);
    const result = json ? schema.safeParse(json) : null;
    if (result?.success) return result.data;
    const problem = result ? z.prettifyError(result.error) : "the reply had no valid JSON object";
    if (attempt === 2) throw new Error(`Claude's reply didn't match the page format: ${problem}`);
    messages.push(
      { role: "assistant", content: response.content },
      { role: "user", content: `That doesn't match the format: ${problem}\nReply with only the corrected JSON object.` },
    );
  }
}

export function readPage(image) {
  return ask(image, "Transcribe this notebook page.", PageReading, 16000);
}

// Second look at a page after blurring, so nothing private slips through.
export function checkRedaction(image) {
  return ask(image,
    "Some areas of this page were blurred to hide personal details. Can you still read " +
    "any phone number, email address, or street address anywhere on it?",
    z.object({ legible: z.boolean(), what: z.array(z.string()) }), 4000);
}
