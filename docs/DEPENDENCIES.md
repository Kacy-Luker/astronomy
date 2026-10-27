# Outside services and what a replacement must do

Every tool or service the log depends on, what it's used for, and the
contract a replacement has to meet (#49). "Wrapped" means the rest of the
code only reaches it through one named module, so swapping it means
writing one new module that meets the contract.

| Dependency | Used for | Wrapped by | Status |
| --- | --- | --- | --- |
| Claude (Anthropic API) | Reading each page; checking blurred pages | `scripts/lib/reader.mjs` | Wrapped |
| OpenNGC, SIMBAD | Catalog info and designations | `scripts/lib/catalog.mjs` | Wrapped |
| sharp (libvips) | Rotating, cropping, resizing, blurring, encoding images | — | Not yet |
| poppler `pdfimages` | Pulling the scanned JPEGs out of a PDF | `scripts/lib/pages.mjs` (`listSpreads`) | Partly |
| numpy, scipy, Pillow | Show-through cleaning | `scripts/showthrough.py` | Wrapped (a script) |
| zod, ajv | Checking readings and the JSON files | — | Not yet |
| GitHub Pages and PR previews | Hosting the site and a preview per PR | `pages.yml`, `preview.yml` | Workflows only |
| GitHub Actions forms and PRs | Import, Complete and Remove; a PR per change | `notebook-job.yml`, `scripts/sync-workflow.mjs` | Workflows only |
| Private scans repo | Raw scans, kept out of this public repo | `notebook-job.yml` | Workflows only |
| claude-code-action | The Docs check on PRs | `docs.yml` | Optional |
| OpenStreetMap tiles | The Map tab's background | `TILES` in `site/map.js` | Wrapped (a constant) |
| Leaflet | The Map tab | `site/map.js` | One file |

## Page reader

**Module:** `scripts/lib/reader.mjs` loads the reader named by `PAGE_READER`
(`claude`, the default, from `scripts/lib/readers/claude.mjs`), or a module
at a path.

**A reader exports:**
- `readPage(image)`: `image` is one notebook page as a JPEG buffer, about
  2000 px tall. It returns the page's reading in the `PageReading` format
  of `scripts/lib/reading.mjs`:
  - the page's category from `data/categories.json`
  - its printed page number, if any
  - the notebook label (front cover and title page)
  - boxes around any phone number, email or street address
  - the NEW SESSION block and each object entry, with their boxes
  - anything it was unsure of
- `checkRedaction(image)`: `image` is the same page after blurring. It
  returns `{ legible, what }`, saying whether any personal detail can
  still be read.
- `name` (optional), for messages.

**It must:**
- Transcribe what's written and add nothing.
- Keep "N/A" (the field doesn't apply) apart from a blank field (`null`,
  a to-do).
- Skip crossed-out entries.
- Give boxes that cover the whole block or entry without cutting through
  writing.
- Err on the side of reporting personal details.

`reader.mjs` checks every answer against the format and refuses one in
another shape, and the import checks cached answers the same way.
`tests/unit/reader.test.mjs` shows the contract with stand-in readers, and
`tests/import.test.mjs` runs the whole import on hand-written readings
without any reader.

**Today:** Claude (`claude-opus-5-5`, effort high, with the server-side
refusal fallback). The answer format is given in the prompt and checked
afterwards, with one retry. The API's enforced structured output can't
compile a schema this large.

## Catalog sources

**Module:** `scripts/lib/catalog.mjs` tries each source in
`scripts/lib/catalogs/` in order. `CATALOG_SOURCES` narrows the list.

**A source exports:** `{ name, version, url, license, load() }`. `load()`
returns an async lookup from a designation to an entry, or `null`. An
entry has:
- `ids`
- `name`, `type` and `constellation`
- `magnitude` and `size`
- `ra` and `dec`

Kacy's mappings (`data/personalObjectMappings.json`) are applied before
any source. The credits in the site's footer come from `name`, `url` and
`license`.

## Show-through cleaning

**Module:** `scripts/showthrough.py <notebook> [positions…]`. It reads
`scans/<id>/NN.jpg` and writes `NN.clean.jpg`.

**It must:**
- Only make pixels lighter.
- Skip a sheet when the fit between its two sides is weak.
- Never touch the back matter.

## Not wrapped yet

These are still called directly. Moving each one behind a module like the
ones above is the rest of #49:
- **Image operations (sharp):** rotate, crop, resize, blur a region, encode
  a JPEG, read an image's size and grey pixels. Today they're called from
  `scripts/lib/pages.mjs`, `match.mjs`, `circle.mjs`, `cover.mjs`,
  `import-cover.mjs` and `build.mjs`.
- **Scan source:** listing an upload's spreads and pulling images out of a
  PDF (`listSpreads` and `pdfimages`), and fetching from the private scans
  repo (`notebook-job.yml`).
- **Publishing and forms:** the build writes a plain static folder with
  relative paths, so any static host works; the GitHub-specific parts are
  the workflows and `scripts/sync-workflow.mjs`.
