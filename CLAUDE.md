# Context for agents

Kacy Luker's astronomy observing log: paper notebooks are scanned, read by
Claude, and published as a static site at <https://kacyluker.com/astronomy/>.
Kacy works mostly from a phone, so anything they do by hand should be
possible in GitHub's web UI or the Actions tab.

The original plan is in `docs/PROJECT_BRIEF.md`; open work is in GitHub
issues. The README covers day-to-day use; this file covers what an agent
needs to change things safely.

## Working rules

- One pull request per feature, against `main`, with short logical commits.
  Open new work as issues rather than widening a PR.
- Every change has an issue, and its branch is named for it:
  `<issue number>-<short-description>`, cut from `main` (e.g.
  `21-blank-field-todos`). The PR says "Closes #<n>". Merged branches are
  deleted automatically.
- Show Kacy before/after evidence (zoomed crops, screenshots) for anything
  that changes how pages look, and ask before building when a choice is
  theirs (privacy, layout, workflow).
- Test site changes in headless Chromium (Playwright with
  `executablePath: '/opt/pw-browsers/chromium'` in cloud sessions) at
  390px and desktop width. The site is dark only (`site/style.css`
  `:root`); there is no light theme. Serve `dist/` under `/astronomy/` to
  match production paths.
- `npm run validate` and `npm run build` must pass. Every PR runs them and
  gets a preview at `kacyluker.com/astronomy/pr-preview/pr-<n>/`.
- Keep README.md and CLAUDE.md in step with the code in the same PR. The
  **Docs** workflow also checks code PRs, commits fixes ("Update docs for
  this change") to the branch and comments what changed; pull before
  pushing again. If its push (with `ASTRONOMY_TOKEN`) is refused, the job
  fails and comments the diff on the PR instead. If Claude's own run
  fails, the job prints the tool calls it was refused and its last message
  (its output is otherwise hidden); Claude may only use Read, Glob, Grep,
  Edit, Write and `git diff/log/show`. It runs on every PR as one `docs`
  job (it skips Claude when no code changed, and times out after 8
  minutes), so `preview` and `docs` can be required checks.

## Privacy

- **This repo is public.** Raw scans live only in the private
  `Kacy-Luker/astronomy-scans` repo. Never commit an unredacted scan or the
  source PDFs here.
- The title page carries Kacy's phone and email. Pages are blurred with
  `redact` boxes before images are written; the import detects personal
  info and re-checks each blurred page with Claude, blurring the whole page
  if anything is still legible. Verify any change to splitting or image
  writing keeps the title page blurred.

## Layout

| Path | What |
| --- | --- |
| `data/notebooks/<id>.json` | Every scanned page in order: `kind`, `number`, `label`, `open`, `redact` (schema: `schema/notebook.schema.json`) |
| `data/categories.json` | Page categories for every notebook, in book order, with `in_progress`, `hidden`, `rescan` and `single` (read by `scripts/lib/categories.mjs`) |
| `data/sessions/<id>.json` | One observing night; `notebook`, `pages`, `header_box`, and `page` and `box` on each observation (schema: `schema/session.schema.json`) |
| `data/objects.json` | Generated catalog info for observed objects, keyed by first designation, with the `sources` they came from (`scripts/lib/catalog.mjs`; schema: `schema/objects.schema.json`) |
| `data/personalObjectMappings.json` | Kacy's catalog mappings: `from` and `to` (each `{ catalog, object }`) and `why` (schema: `schema/personal-object-mappings.schema.json`) |
| `scripts/lib/catalogs/` | Catalog sources behind one interface (`scripts/lib/catalog.mjs`): `openngc.mjs` (pinned, cached in `.catalog-cache/`), then `simbad.mjs` (network, only for what OpenNGC misses; answers cached in `.catalog-cache/simbad/`, a failed request is a miss) |
| `scans/<id>/NN.jpg` | Page images in scan order (NN = position + 1), 1600 px tall, redacted |
| `scans/<id>/NN.clean.jpg` | Same page with stamp show-through removed, when possible |
| `site/` | Static pages: home (Notebooks, Sessions and Sketches tabs, `#notebooks`, `#sketches/ngc` etc.), `notebook.html?id=`, `session.html?id=`, `object.html?id=` (any designation, e.g. `M31` or `NGC 224`), `view.html?img=&view=` (one page full size) |
| `scripts/` | Build, validation, import, splitting, cleaning |
| `.github/workflows/` | `pages.yml` (deploy), `preview.yml` (PR previews + checks), `docs.yml` (Claude updates README/CLAUDE.md on code PRs), `import-notebook.yml`, `complete-notebook.yml`, `remove-notebook.yml` (the three forms, all calling `notebook-job.yml`) |

On the sheet Kacy writes N/A where a field doesn't apply; that's stored
as `"N/A"` (the schema allows it for numbers and times too). A blank field
is `null` or missing and is a to-do. Every field but AKA counts; the list
is `site/todos.js`, used by the site and the import summary. Keep the two
apart in the reader prompt and importer.

Catalog lookups go through `scripts/lib/catalog.mjs`, which tries each
source in `scripts/lib/catalogs/` in order. A source exports `{ name,
version, url, license, load() }`, and `load()` returns an async lookup
from a designation to an entry (`ids`, name, type, constellation,
magnitude, size, RA/Dec) or null; that is the whole contract, so a source
can be swapped for another. Each object records its `source`, and
`data/objects.json` lists the sources used, for the credits. SIMBAD is
reached over the network: `sim-id` resolves a designation the way its
search box does, then TAP gives the data. In cloud sessions Node's fetch
needs `NODE_USE_ENV_PROXY=1` to go through the proxy (Actions needs
nothing). Kacy's
mappings (`data/personalObjectMappings.json`) are applied first: a mapped
designation is looked up as its target, so info and other IDs come from
the target, never the original, and the mapped designation is added to the
target's `ids` however it's looked up (M102 is NGC 5866, not OpenNGC's
duplicate of M101). Validation checks the file: each side is a catalog
designation, nothing maps to itself, and each object is mapped once. The
build adds a footer to every page crediting the databases in
`data/objects.json` (only databases are credited) and linking the
mappings file.

Catalog lookups (import and `scripts/enrich-ids.mjs`) only add: they
append designations to `ids` and regenerate `data/objects.json`, but never
change `catalog_id`, `aka` or IDs already there (M51's NGC 5195 was added
by hand). The build attaches each object's catalog info to its
observations, and the site prefers `aka` over the catalog name.

JSON files are hand-edited by Kacy; write them with
`scripts/lib/format-json.mjs` so diffs stay small. Seeing and transparency
are stored 1–5 for the sheet's I–V and shown with the Clear Sky Chart's
words: seeing I is Excellent and V Bad, transparency I is Poor and V
Transparent (`site/lib.js`). The key printed in the notebook isn't used.

## The notebook

- Each scan is a two-page spread, scanned sideways (`scan.rotate: 90`).
- Odd page numbers are printed top outer corner on right-hand pages; even
  ones are inferred. Front matter (covers, title, table of contents, key) is
  unnumbered and labeled instead.
- Entries are rubber-stamped forms filled in pencil. A session starts with
  a NEW SESSION header; later pages without one continue it. Crossed-out
  entries are skipped.
- Every page has a category from `data/categories.json`; Kacy keeps one
  list for all notebooks, not per-notebook settings or page counts. The
  front of the book has a table of contents (sessions by program and date);
  the back has an index (objects by catalog with page) and the maker's info
  page. Pages are kept in category order, session pages by number;
  validation checks it, and that only-one categories appear once.
- While a notebook is in progress only categories with `in_progress` are
  shown (front cover, title page, scales, session pages, info page), and
  blank pages are left off; no placeholders. Completing checks the `rescan`
  categories (front cover, table of contents, index) and lists blank pages.
- The outside front cover (with the volume label: title, start and finish
  dates, owner) is saved to `scans/<id>/cover-front.jpg`, not a page
  position, so page images never shift for it, and shown on the home
  page's notebook card. The notebook view shows it beside the title page:
  the inside front cover is recorded (so spreads stay physical) but never
  shown (`hidden` in `data/categories.json`). It's scanned closed, so the scanner's lid fills the
  rest of the scan; `scripts/lib/cover.mjs` trims to the cover. The import
  finds a closed-notebook scan among the spreads (Claude reads one half as
  `front_cover`, the lid as blank) and keeps it apart from the pages; a
  cover scanned on its own goes through `scripts/import-cover.mjs` (Import
  with Front cover as the category).
- Back matter (categories after the session pages) stays at the end of
  `pages`: the info page is scanned early and new session pages are
  inserted before it. Page images are named by position, so the import
  rewrites every image after an inserted page. Back matter isn't
  show-through-cleaned, since its other sides aren't scanned, and is paired
  into spreads from the end of the book.
- Pages that will still change (table of contents, blank pages after the
  last written one, session pages with room) are `open`: re-read on the
  next import and, except session pages, left off the site until the
  notebook is completed.

## Import pipeline (`scripts/import-notebook.mjs`)

Run from three forms in Actions: **Import**, **Complete notebook** and
**Remove notebook**. Each is a thin `workflow_dispatch` wrapper with only
its own fields, calling the shared `notebook-job.yml` (`workflow_call`,
`secrets: inherit`), which does the work. **Import** picks its mode from
the form: `new` when the notebook is `new-notebook` (the id
is the scan's folder in astronomy-scans, or the one folder with no
notebook yet), `cover` when the category is Front cover
(`scripts/import-cover.mjs`), `replace` when **reread** is ticked, else
`add`. **Complete notebook** has two steps: mark completed and list what
to rescan, then import the rescan, in any order. **Remove notebook**
requires typing the id in `confirm`. Each opens a PR using `ASTRONOMY_TOKEN`,
a personal token that also has Workflows write so the forms' notebook and
category dropdowns (generated by `scripts/sync-workflow.mjs`; Complete and
Remove list only existing notebooks) can be updated.

1. **Split** (`scripts/lib/pages.mjs`): the file type is sniffed, spreads
   are rotated, and the fold is found per spread (a faint full-height
   crease, never through writing; weak detections use the median of the
   others, then `scan.split`). The fold position varies with scanner
   placement, so don't assume a fixed split.
2. **Read** (`scripts/lib/read-page.mjs`): `claude-opus-5-5`, effort high,
   server-side refusal fallback. The page format is given as a JSON Schema
   in the prompt and validated with Zod, with one retry. Don't switch to
   API-enforced structured output: the schema is too large ("compiled
   grammar is too large").
3. **Place**: Claude's category (or `--category`, the form's category
   dropdown) decides where a page goes; session pages go by printed odd
   page numbers, which always win, with the others counted from them. Only
   when none was read does `--start N` (the form's start page) number
   session pages from N in scan order, for numbers missed by the scanner.
   An unnumbered blank goes beside the page it faces. A page replaces
   what's there when re-reading (replace, complete) or when that page is
   open; otherwise it's skipped, so only-one pages aren't duplicated. Add
   mode first matches the upload against published images
   (`scripts/lib/match.mjs`) and reads only new and open pages; on a page
   that already has entries, only entries beyond that count are added, so
   hand corrections survive.
4. **Clean show-through** (`scripts/showthrough.py`, Python with numpy,
   scipy, Pillow from `requirements.txt`; locally `.venv/bin/python`).
   Stamp ink soaks through the paper; pencil doesn't. Pages pair by number
   (odd N is backed by N + 1). The mirrored back is best-fit onto the front
   using stamp ink only, at half size over a wide window, scoring both sides
   together; the sheet is skipped unless the best fit leads by 15%. Ghost
   pixels are rebuilt from their neighborhood and may only get lighter.
   Painting ghosts with paper left white bands through sketches, and
   subtracting a fitted ghost strength under-corrected; don't go back to
   either.

Readings are cached in `.import-cache/` (gitignored). Without an API key,
the pipeline can be tested by placing hand-written readings there (they
must match `PageReading` in `read-page.mjs`).

## Site

- Hosted on GitHub Pages from the `gh-pages` branch as a project site under
  the `kacy-luker.github.io` user site's domain, so all asset paths are
  relative. The main deploy must leave `gh-pages/pr-preview/` alone.
- Scans have an Inverted / Cleaned / Original toggle; Inverted (of the
  cleaned image) is the default. Inversion is a CSS filter, so pages link
  to `view.html` (which applies the same view), not to the bare JPEG.
- The contents table on each notebook page is generated from sessions.
- The home page's Sketches tab groups observations by catalog object (M31
  and NGC 224 are one) and shows one catalog at a time, picked with a
  toggle (`#sketches/ngc`); an object is listed under every catalog it's
  in, in catalog order (`site/catalog.js`, shared with the import:
  Messier, NGC, IC, Caldwell, then others, by number). Each row has a
  thumbnail of the latest sketch and links to the object page, which shows
  one sketch at a time (a toggle picks the session) and every observation,
  newest first. Both use `site/objects.js` for the grouping; the session
  and object pages share the entry fields (`site/observation.js`).
- Sketch images: the build cuts each session's `header_box` (NEW SESSION
  block) and each observation's `box` from their pages, from the cleaned
  and original page images in `scans/` only (already redacted), into
  `sketches/<session>/header.jpg` and `<n>.jpg`, each with a `.clean.jpg`.
  They're shown as cards from `site/cards.js`, so they look the same
  everywhere: a session card (the block alone, top of the session page),
  an object card (the entry alone, on each of the session page's
  observations), and a joint card (block and entry as two images with a
  gap, never merged into one; the object page). An entry is always paired
  with its own session's block, and validation checks each entry comes
  after its session's `header_box`. On the session page the view toggle
  applies to the whole page (pages and cards). The Sketches tab's thumbnails
  (`<n>.thumb.jpg`, `.thumb.clean.jpg`, 240 px, shown at 96 px) show just
  the sketch circle, which `scripts/lib/circle.mjs` finds with a Hough
  search over the entry's ink (the whole entry if none is found). Boxes
  are `[x, y, width, height]` fractions; the reader returns them at import
  and Kacy can fix them by hand. `view.html` accepts `scans/` and
  `sketches/` images.
- Search (`site/search.js`): one document per observation with every
  field of it and its session (designations also without spaces), and a
  query that matches when every word appears; case and accents are
  folded. The home page's search box sits above the tabs and narrows all
  three (`?q=` in the URL, kept by the tab links). Filters (`FILTERS` in
  `site/search.js`; values per observation on each document) and the bar
  (`site/filterbar.js`: search box, Filters panel, chips, Clear all) are
  on every page and in the URL; `keepFilters()` adds them to links between
  pages. Home narrows its tabs, the session page dims non-matching
  observations, the object page shows only matching ones, the notebook
  page dims contents rows. Each page passes the bar its own observations,
  so dropdowns offer only that page's values (one value: hidden), and a
  page listing fewer than two things gets no bar at all. Add a filter in
  `FILTERS`, not in a page.
- Admin mode (Kacy only): `?admin=on` on any page, remembered in
  localStorage (`?admin=off` clears it), adds an admin bar to the footer
  with a link to `help.html` (Kacy's phone how-to; keep it in step with
  the forms and the README's Importing section) and an Edit links toggle
  (also remembered; switching reloads the page).
  With it on, `editLink()` in `site/lib.js` (which also holds the repo URL)
  links to GitHub's web editor for the session, each observation, the
  notebook and the mappings file. On PR previews they open the PR branch
  (`PREVIEW_BRANCH` from `preview.yml`, on the preview banner's
  `data-branch`); the setting is shared with previews (same origin). Anything only Kacy should see goes behind `adminMode`
  (or `editMode` for Edit links).
- `scripts/build.mjs` adds the icon and manifest links (`site/icons/`,
  `site/manifest.webmanifest`) to every page's `<head>`, so new pages
  don't need them; without them browsers show kacyluker.com's favicon.
  Chrome on Android takes home-screen icons from the manifest. Strip
  photo metadata (location) from any image added there.
- The manifest makes the site installable (`display: standalone`): Chrome
  offers "Install app", and the installed log opens without an address
  bar and with a full-tile (maskable) icon. Keep pages navigable without
  the browser's own controls.
