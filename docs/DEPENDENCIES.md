# Outside services and what a replacement must do

Every tool or service the log depends on, what it's used for, and the
contract a replacement has to meet (#49). "Wrapped" means the rest of the
code only reaches it through one named module, so swapping it means
writing one new module that meets the contract. `tests/unit/wrapped.test.mjs`
fails if another file starts using a wrapped library or tool directly.

| Dependency | Used for | Wrapped by | Status |
| --- | --- | --- | --- |
| Claude (Anthropic API) | Reading each page; checking blurred pages | `scripts/lib/reader.mjs` | Wrapped |
| OpenNGC, SIMBAD | Catalog info and designations | `scripts/lib/catalog.mjs` | Wrapped |
| sharp (libvips) | Rotating, cropping, resizing, blurring, encoding images | `scripts/lib/image.mjs` | Wrapped |
| poppler `pdfimages` | Pulling the scanned JPEGs out of a PDF | `scripts/lib/scans.mjs` | Wrapped |
| numpy, scipy, Pillow | Show-through cleaning | `scripts/showthrough.py` | Wrapped (a script) |
| zod | Data formats: page readings | `scripts/lib/schema.mjs` | Wrapped |
| ajv | Checking the JSON files against `schema/` | `scripts/validate.mjs` | One file (standard JSON Schema) |
| GitHub Pages and PR previews | Hosting the site and a preview per PR | `.github/actions/publish`, `preview.yml` | Wrapped (publishing); see GitHub below |
| GitHub Actions forms and PRs | Import, Complete and Remove; a PR per change | `notebook-job.yml`, `.github/actions/open-pr`, `scripts/sync-workflow.mjs` | GitHub-only; see GitHub below |
| Node, Python and poppler on the runners | Every workflow's setup | `.github/actions/setup` | Wrapped |
| Private scans repo | Raw scans, kept out of this public repo | `scripts/lib/scans.mjs`; fetched by `notebook-job.yml` | Wrapped, except the fetch |
| claude-code-action | The Docs check on PRs | `docs.yml` | Optional |
| OpenStreetMap tiles | The Map tab's background | `TILES` in `site/map.js` | Wrapped (a constant) |
| Leaflet | The Map tab | `site/map.js` | One file |

## Page reader

**Module:** `scripts/lib/reader.mjs` loads the reader named by `PAGE_READER`
(`claude`, the default, from `scripts/lib/readers/claude.mjs`), or a module
at a path.

**A reader exports:**
- `readPage(image, { form })`: `image` is one notebook page as a JPEG
  buffer, about 2000 px tall. `form` is what the notebook is written on
  (from its type in `data/notebook-types.json`): `"stamped"`, the printed
  log sheet, or `"free"`, free text where a session starts at a date
  heading (#109). It returns the page's reading in the `PageReading` format
  of `scripts/lib/reading.mjs`:
  - the page's category from `data/categories.json`
  - its printed page number, if any
  - the notebook label (front cover and title page)
  - boxes around any phone number, email or street address
  - the NEW SESSION block (in free text, the date heading and the lines
    about the night) and each object entry, with their boxes
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

## Image operations

**Module:** `scripts/lib/image.mjs`. Nothing else in `scripts/` or `site/`
imports the image library; a unit test checks that. The test-page drawing
script also uses it to render SVG, but it isn't part of the import or the
site.

**The contract:**
- `image(input)` takes a file path or a buffer and returns a chain of
  steps, applied in the order called:
  - `rotate(degrees)`: clockwise; with no angle, upright by the photo's
    EXIF.
  - `crop({ left, top, width, height })`, in pixels.
  - `resize({ width, height, fit, background, withoutEnlargement })`:
    either side alone keeps the aspect ratio; `fit` is `fill` or
    `contain`.
  - `grey()`, `blur(sigma)` and `invert()`.
  - `overlay([{ input, left, top }])`: images laid over this one.
  - `jpeg({ quality, mozjpeg })` or `png()`.
- The chain ends in `buffer()`, `toFile(path)` or `pixels()`. `pixels()`
  gives `{ data, width, height, channels }`: raw bytes, rows top to
  bottom.
- `size(input)` returns `{ width, height }`.
- `blank(width, height, colour)` starts a new chain on an image of one
  colour.

`tests/unit/image.test.mjs` checks each operation on a small drawn image.
A replacement should also give the same results on the real pages: the
fold finder, the blur of personal details, the circle finder and the
rescan matcher all read these pixels. The import, circle and redaction
tests cover them.

## Scan source

**Module:** `scripts/lib/scans.mjs`.

**Where uploads live:**
- A folder per notebook in the private `astronomy-scans` repo,
  `<notebook>/<date>[-HHMM].<ext>`.
- The Notebook job workflow fetches the repo into `.scans/` (one
  `actions/checkout` step). Moving the scans elsewhere means replacing
  that step with one that fills `.scans/` the same way.

**The contract:**
- `pickScan({ store, mode, picked, scan, hasNotebook })` decides which
  notebook and upload a form run is for:
  - the scan given, or else the notebook's newest (`newestScan`)
  - a new notebook named for its folder
  - otherwise the problem, in words meant for Kacy
  - `scripts/pick-scan.mjs` runs it for the workflow.
- `listSpreads(source, workDir)` turns a scan into spread image files: a
  PDF's embedded images (via poppler's `pdfimages`), one image, or a
  folder of images.
- `sniff(file)` tells what a file really is from its first bytes, so an
  iPhone HEIC photo or a Git LFS pointer is caught with a clear message.

`tests/unit/scans.test.mjs` covers each case.

## Data formats

**Module:** `scripts/lib/schema.mjs`, using zod.
- Formats are built with its `z`, as in `scripts/lib/reading.mjs`.
- `check(format, value)` gives `{ ok, data }` or `{ ok: false, problem }`.
- `asJSONSchema(format)` gives the JSON Schema the Claude reader puts in
  its prompt.

The JSON files in `data/` are checked separately by `scripts/validate.mjs`
against the standard JSON Schemas in `schema/` (with ajv). Any JSON Schema
validator could take its place.

## Show-through cleaning

**Module:** `scripts/showthrough.py <notebook> [positions…]`. It reads
`scans/<id>/NN.jpg` and writes `NN.clean.jpg`.

**It must:**
- Only make pixels lighter.
- Skip a sheet when the fit between its two sides is weak.
- Never touch the back matter.

## GitHub

The scripts don't depend on GitHub: they read and write files in the repo,
and the site is a plain static folder with relative paths. What's
GitHub-specific is in the workflows, and the steps several workflows share
are actions in `.github/actions/`:
- **`setup`:** Node 22 with `npm ci`, and when asked Python 3.13 with
  `requirements.txt` and poppler. Every workflow's versions are here.
- **`open-pr`:** commits paths to a branch and opens a pull request,
  giving its address. Used by the Notebook job and Favorite.
- **`publish`:** copies a built folder to the `gh-pages` branch, at the
  top (keeping `pr-preview/` and `test/`) or in a folder. Used for the
  live site and the test site.

`tests/unit/wrapped.test.mjs` fails if a workflow uses one of those
actions directly.

**What moving off GitHub would take:**
- **Hosting:** serve `npm run build`'s `dist/` (and a `TEST_SITE=1` build
  under `test/`) from any static host. Replace `publish`. PR previews
  (`preview.yml`, rossjrw/pr-preview-action) would need the new host's
  equivalent.
- **The forms:** Import, Complete notebook and Remove notebook are
  `workflow_dispatch` forms whose dropdowns `scripts/sync-workflow.mjs`
  rewrites. Elsewhere they'd be any way of running
  `scripts/import-notebook.mjs`, `import-cover.mjs` or
  `remove-notebook.mjs` with the same arguments.
- **Review before publishing:** every change arrives as a pull request
  (`open-pr`), which Kacy merges or auto-merge merges after the checks.
  Another platform needs the same branch, review and merge steps.
- **Favorites:** `favorite.yml` acts on issues Kacy opens from the site's
  star; the star's link (`favoriteLink()` in `site/lib.js`) and that
  workflow would change together.
- **The scans:** see Scan source; only the fetch into `.scans/` is GitHub.
- **The Docs check:** `docs.yml` runs claude-code-action on pull requests.
  It's optional: nothing else depends on it.
