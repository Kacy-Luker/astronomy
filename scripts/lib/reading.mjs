// What a page reader must return (docs/DEPENDENCIES.md): the format of
// one notebook page's reading, and of the check that a blurred page shows
// nothing private. Any reader (scripts/lib/readers/) is held to these by
// scripts/lib/reader.mjs, and the Claude reader also gives them to Claude
// as the answer format.
import { z } from "zod";
import { READ_KINDS } from "./categories.mjs";

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

// The writer puts N/A in fields that don't apply; a blank field is null.
const NA = z.literal("N/A");
const Scale = z.union([z.number().int(), NA]).nullable()
  .describe('Circled roman numeral as 1-5 (I is 1), as circled, without converting by any key; "N/A" if written; null if none circled');

export const PageReading = z.object({
  kind: z.enum(READ_KINDS).describe("The page's category"),
  printed_number: z.number().int().nullable()
    .describe("Page number printed in the top outer corner, if one is visible"),
  label: z.string().nullable()
    .describe("Short name for a page that isn't a session page, e.g. 'Seeing and transparency key'"),
  will_change: z.boolean()
    .describe("True if more will be written on this page as the notebook fills"),
  notebook_label: z.object({
    title: z.string().nullable(),
    owner: z.string().nullable(),
    started: z.string().nullable().describe("YYYY-MM-DD"),
    finished: z.string().nullable().describe("YYYY-MM-DD"),
  }).nullable().describe("Only for the front cover's volume label or the title page"),
  personal_info: z.array(z.object({ what: z.string(), box: Box }))
    .describe("Phone numbers, email addresses, and street addresses on the page"),
  header: z.object({
    program: z.string().nullable(),
    date: z.string().describe("YYYY-MM-DD"),
    site: z.string(),
    lat: z.union([z.number(), NA]).nullable(),
    lon: z.union([z.number(), NA]).nullable(),
    sqm: z.union([z.number(), NA]).nullable(),
    sky_notes: z.string().nullable(),
    scope: Scope.nullable(),
    observers: z.array(z.string()),
    box: Box.nullable().describe("The whole NEW SESSION block, from the wavy line to OBSERVER"),
  }).nullable().describe("The NEW SESSION block, if this page starts a session"),
  entries: z.array(z.object({
    catalog_id: z.string(),
    aka: z.string().nullable(),
    local_time: z.string().nullable().describe("HH:MM"),
    ut: z.string().nullable().describe("HH:MM"),
    seeing: Scale,
    transparency: Scale,
    eyepiece: z.string().nullable(),
    magnification: z.union([z.number(), NA]).nullable().describe("The MAG half of EP/MAG, e.g. 92 for 92x"),
    filter: z.string().nullable(),
    description: z.string().nullable(),
    box: Box.nullable().describe("The whole entry: from its top dotted line to its bottom one, wide enough for description lines that run past the stamp"),
  })).describe("Object entries in page order, skipping crossed-out entries"),
  uncertain: z.array(z.string())
    .describe("Readings you are unsure of, e.g. 'M110 description: last word may be dim'"),
});

export const RedactionCheck = z.object({ legible: z.boolean(), what: z.array(z.string()) });
