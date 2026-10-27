# Observing Log

Astronomy observations transcribed from paper notes, published at
<https://kacyluker.com/astronomy/>.

## Layout

| Path | What it holds |
| --- | --- |
| `data/notebooks/` | One JSON file per paper notebook, listing every page |
| `data/sessions/` | One JSON file per observing session |
| `data/objects.json` | Catalog info for every observed object, from OpenNGC (generated) |
| `data/personalObjectMappings.json` | Objects you take differently from the catalogs (edit by hand) |
| `schema/` | The shape every notebook and session file must match |
| `scans/<notebook>/` | One image per notebook page, in order (`01.jpg`, `02.jpg`, …) |
| `site/` | Static site source (HTML, CSS, JS) |
| `site/icons/` | Site icons from Kacy's telescope photos: a wide crop at 16 and 32 px, a close-up at 180, 192 and 512 px (the larger ones also listed in `site/manifest.webmanifest`, with wider "maskable" crops that fill Android's home-screen tile) |
| `scripts/` | Build and validation scripts |
| `docs/PROJECT_BRIEF.md` | The plan this site is built from |
| `CLAUDE.md` | Context for AI agents working on the repo |

## Local use

```sh
npm install
npm run validate   # check data against the schemas and page order, and the forms' dropdowns
npm run build      # write the site to dist/
npm run serve      # build and preview locally
```

## Notebooks

Each paper notebook has a file like `data/notebooks/astronomy-001.json`
that lists every scanned page in order: covers, title, table of contents,
reference, session pages, blanks, and back matter. Page numbers are
printed on odd pages; even ones are inferred. Other pages are named by
their category.

Pages belong to categories, listed once for every notebook in
`data/categories.json` in the order they come in the book and on the site:

| Category | Kind | In progress | Completing | Only one |
| --- | --- | --- | --- | --- |
| Front cover (outside) | `front_cover` | shown | rescanned | yes |
| Inside front cover | `inside_front_cover` | hidden | | yes |
| Volume label | `volume_label` | hidden | | yes |
| Title page | `title` | shown | | yes |
| Table of contents | `contents` | hidden | rescanned | |
| Scales | `reference` | shown | | |
| Session pages | `session` (and `unused`) | shown | | |
| Index (objects by catalog) | `index` | hidden | scanned | |
| Notebook info | `info` | shown | | yes |
| Inside back cover | `inside_back_cover` | hidden | | yes |

Reorder or change them by editing that file. Claude puts each scanned page
in a category, and the import places it where its category comes; session
pages go by page number. Blank pages go beside the page they face, and are
left off while a notebook is in progress. Once a notebook has a page from
an only-one category, later uploads skip it unless it's being re-read. The
info page can be scanned early: later session pages go in before it.

If Claude puts pages in the wrong category, pick the right one in the
Import form's **category** dropdown, and every non-blank page in the scan
goes in that category. The dropdown is generated from
`data/categories.json` by `scripts/sync-workflow.mjs`.

To turn a notebook scan (a PDF of two-page spreads, or a folder of
images) into page images:

```sh
node scripts/split-notebook.mjs astronomy-001 path/to/scan.pdf
```

It rotates each spread upright, cuts it at the fold, blurs any `redact`
boxes, and writes `scans/astronomy-001/01.jpg`, `02.jpg`, and so on. The
fold is found in each spread (a faint crease that runs the page's height,
cut where it won't go through writing), since scanner placement moves it;
a spread with no visible fold uses the median of the others, or the
notebook file's `scan.split` when none can be seen.
Use `redact` on a page to blur personal details such as a phone number.
Keep unredacted scans out of the repo, since it's public.

## Importing

Scans go to the private **astronomy-scans** repo as
`<notebook id>/<date>.pdf` (a JPEG works too), for example
`astronomy-001/2026-10-20.pdf`. Add a 24-hour time when you upload more
than once a day: `astronomy-001/2026-10-20-1350.pdf`. Then open
**Actions → Import → Run workflow** here, fill in the form, and review the
pull request it opens before merging. Merge each import before the next.

There are three forms in the Actions list, each with only the fields it
needs. **Import** handles every upload, and works out what it is from the
form:

| To | Pick | Scan |
| --- | --- | --- |
| Add a session | the notebook | The spreads you wrote on, including the one you started on. Only new pages and pages still being written on are read |
| Start a notebook | **new-notebook** | From the inside front cover through any sessions so far, in a new folder named for the notebook, e.g. `astronomy-002/`. The folder name becomes the notebook's id |
| Re-read pages | the notebook, and tick **reread** | The spreads to re-read, for a misread page or a rescan. What was recorded for those pages is replaced |
| Add the front cover | the notebook, and **Front cover** as the category | The closed notebook on the scanner, on its own. The scanner bed is trimmed off and the cover turned upright; run it again to replace it |

| Form | When | Scan |
| --- | --- | --- |
| **Complete notebook** | The notebook is full | Run once with no scan to mark it completed and get the rescan checklist; then scan the spreads it lists, in any order, into one file and run it again with that file. Rescan the front cover with **Import** and **Front cover** |
| **Remove notebook** | Taking a notebook off the site | No scan. Type the notebook's id in **confirm**; it opens a pull request deleting the notebook, its page images and its sessions (the scans in astronomy-scans are kept) |

The scan field can be left empty to use the newest file in the notebook's
folder; for a new notebook, that's the one folder with no notebook yet
(type the path if there's more than one). For **Complete notebook**, empty
means no scan. The notebook and category dropdowns are generated from
`data/notebooks/` and `data/categories.json` by
`scripts/sync-workflow.mjs`; a new notebook appears in them once its
import is merged. All three forms share their steps through
`.github/workflows/notebook-job.yml`, and run one at a time.

**Start page.** Session pages are placed by the page numbers printed on
odd pages, and a printed number always wins: if any page in the scan shows
one, the others are counted from it. If none came out in the scan, the
number in **start page** is used instead: the scan's first session page
gets it and the rest are numbered in scan order (a blank page just before
them counts too). A start page that disagrees with printed numbers is
noted in the pull request. A start page makes an import read every page
in the scan.

**Open pages.** Pages that will still change are marked `"open": true`:
the table of contents, a volume label with no finish date, blank pages
after the last one written on, and session pages with room for another
entry. Open pages are re-read by the next import, and all but session
pages are left off the site until the notebook is completed.

**Completing.** **Complete notebook** marks the categories that are
rescanned (front cover, table of contents, index) as waiting, and its pull
request has a checklist of them; later completion scans tick them off. It
also lists every blank page for you to check, and any other category with
nothing scanned.

**How it reads.** The import splits each spread into pages and asks
Claude (Opus 5.5) to read them. Pages are placed by category and printed
odd page numbers; adding a session first matches the upload against the
published pages so pages already recorded aren't read again (a scan with
a chosen category is always read in full). Entries are grouped into
sessions (a page without a NEW SESSION header continues the last one); on
a page that already has entries, only entries beyond those are added, so
nothing is duplicated and hand corrections survive. Phone numbers, emails and
addresses are blurred, and each blurred page is checked again; if anything
is still readable the whole page is blurred. Expect roughly 5–10 cents per
page read.

Locally, the same thing runs as:

```sh
ANTHROPIC_API_KEY=... node scripts/import-notebook.mjs astronomy-001 path/to/scan.pdf --mode add
```

`--mode` is `new`, `add`, `replace` or `complete`; `--category` and
`--start` are the form's category and start page. A front cover is
imported with `node scripts/import-cover.mjs astronomy-001 path/to/cover.jpg`.

One-time setup:

1. Create a **private** repo named `astronomy-scans`.
2. Create a fine-grained token with access to `astronomy-scans` (Contents:
   read-only) and to this repo (Contents, Pull requests and Workflows:
   read and write). Imports open pull requests with it, and Workflows
   access lets them update the forms' dropdowns. The Docs check also
   pushes its fixes with it.
3. In this repo, under **Settings → Secrets and variables → Actions**, add
   the repository secrets `ASTRONOMY_TOKEN` (that token) and
   `ANTHROPIC_API_KEY`.

## Show-through

Rubber-stamp ink soaks through the paper and shows as a faint mirrored
ghost on the other side of the sheet; pencil doesn't.
`scripts/showthrough.py` removes those ghosts and writes a cleaned copy,
`scans/<id>/NN.clean.jpg`, beside each page it can clean:

1. Pages pair by printed number (odd page N is backed by page N + 1;
   unnumbered front matter pairs by position). Back matter (index, info
   page) isn't cleaned, since the pages behind it aren't scanned.
2. The back is mirrored and best-fit onto the front using its stamp ink
   only, scoring both sides of the sheet together. Scanner placement varies
   between spreads, so the search is wide and allows a slight rotation; the
   sheet is left alone unless one fit clearly wins.
3. Inside the ghost's footprint, faint pixels are rebuilt from the pixels
   around them and can only get lighter, so a ghost on blank paper becomes
   paper and a sketch under a ghost keeps its shading. Dark pencil and
   print are never changed.

Imports run it for the pages they touch; a page is cleaned once both sides
of its sheet are scanned. To (re)clean a whole notebook:

```sh
python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/showthrough.py astronomy-001
```

On the site, scans have an **Inverted / Cleaned / Original** toggle.
Inverted (the default) shows the cleaned page with light and dark swapped.
Tapping a page opens it full size (`view.html`) in the same view.

## Session files

Name each file `<date>-<site>.json` and set its `id` to the same slug, for
example `data/sessions/2026-10-11-okie-tex-2026.json` with `"id":
"2026-10-11-okie-tex-2026"`. Set `notebook` and `pages` to where the
session is written, and `page` on each observation. Seeing and
transparency use the log sheet's I–V scale, stored as 1–5, with the Clear
Sky Chart's words: seeing I Excellent, II Good, III Average, IV Poor, V
Bad; transparency I Poor, II Below average, III Average, IV Above average,
V Transparent. `header_box` (the NEW SESSION block's page and box) and
each observation's `box` say where the sketch image is cut from, as `[x,
y, width, height]` fractions of the page image; the import fills them in,
and if a sketch is cut off on the site, widen its box by hand.

**To-dos.** A field written as N/A is stored as `"N/A"`: it doesn't
apply. A field left blank is `null` (or left out) and counts as a to-do,
to come back to. Every field counts except AKA. EP/MAG is two fields,
eyepiece and magnification, so a missing magnification is its own
to-do. The site marks to-dos with **To do** and shows a count on each
session; an import's pull request lists the new ones. Which fields
count is set in `site/todos.js`.

**Your object mappings.** `data/personalObjectMappings.json` lists
objects you take differently from the catalogs: each mapping has the
catalog and object being remapped (`from`), the catalog and object it's
mapped to (`to`), why, and the list or program it follows, if any
(`credit`; leave it out when it's your own call). An object written as
`from` is looked up as `to`, so its info and other designations come
from the `to` object, and `from` is added to them. M102 is mapped to
NGC 5866 (the Spindle Galaxy), as in the Astronomical League's Messier
program, rather than OpenNGC's duplicate of M101. Catalogs are Messier,
NGC, IC, Caldwell, or another catalog's prefix. Edit it on GitHub, then
run `node scripts/enrich-ids.mjs` (or the next import) to update the
sessions. Every page's footer credits the catalog databases the objects
came from and links this file, naming the lists its mappings cite.

**Catalog info.** Each import looks the objects up in
[OpenNGC](https://github.com/mattiaverga/OpenNGC) (a pinned release, CC
BY-SA 4.0), through `scripts/lib/catalog.mjs`: each catalog source is a
module in `scripts/lib/catalogs/` with the same small interface, so one
can be swapped or another added. It adds the object's Messier, NGC, IC
and Caldwell designations to `ids` (M31 gets NGC 224, NGC 7000 gets
C 20) and writes `data/objects.json` with each object's common name,
type, constellation, magnitude and size. An object written by another
catalog number OpenNGC knows (UGC, PGC, LBN, Sh2, …) is found too, but
those numbers aren't added. IDs already there stay, and `aka` stays as
written; the site shows the catalog's common name when the sheet has
none. Don't edit `data/objects.json` by hand. To fill in existing
sessions, run `node scripts/enrich-ids.mjs`; it only adds. Objects
OpenNGC doesn't cover (stars, planets, most Barnard and Abell objects)
are left as written. The home page's Sketches tab shows one catalog at
a time, picked with a toggle, and lists every observed object under each
catalog it's in (M31 under Messier and NGC), in catalog order, with a
thumbnail of its latest sketch (just the sketch circle, found
automatically), its latest observation and a count when there are more.
Tapping an object opens its page (`object.html?id=M31`): the catalog
info, its sketch, shown as the session's NEW SESSION block and the entry,
two images with a gap (a toggle picks the session when there are
several), and every observation of it, newest first.

## Hosting

Pushes to `main` build the site and publish it to the `gh-pages` branch,
which GitHub Pages serves. The site is a GitHub Pages project site, so it
is served under the custom domain of the `kacy-luker.github.io` user site
at `/<repo name>/`. Keep the repo named `astronomy` (lowercase) so the URL
is `kacyluker.com/astronomy/`.

One-time setup: repo **Settings → Pages → Build and deployment → Source**,
choose **Deploy from a branch**, then branch `gh-pages`, folder `/ (root)`.
Leave **Custom domain** empty, and don't add DNS records; the user site's
domain already covers this path. Avoid an `astronomy/` folder in the user
site repo, since it would claim the same path.

Asset and data paths in `site/` are relative so the site works under
that subpath and under preview paths.

On an Android phone, Chrome's menu offers **Install app** (or **Add to
Home screen**, then **Install**). The installed log gets the full-tile
telescope icon and opens without Chrome's address bar. A plain shortcut
instead shows the icon on a white tile. Each PR preview installs as its
own app, so remove a preview's icon once you're done testing.

### Pull request previews

Every pull request, including import PRs, is built and published at
`kacyluker.com/astronomy/pr-preview/pr-<number>/`, with a banner saying
it's a preview. A comment on the PR links to it and updates on each push.
The preview is removed when the PR is merged or closed. The main deploy
leaves `gh-pages/pr-preview/` alone.

### Docs check

Pull requests that change code (scripts, site, schemas, workflows,
dependencies, `data/categories.json`) also run **Docs**: Claude reads the
change and updates this README and `CLAUDE.md` where they no longer match
it, and commits the fix to the pull request's branch as "Update docs for
this change". It then comments on the pull request with what changed, a
link to that commit, and the diff. Review it with the rest. It uses the
`ANTHROPIC_API_KEY` secret, about the cost of reading a page or two per
run, and pushes with `ASTRONOMY_TOKEN` so the pull request's checks run
on its commit. That token needs **Contents: Read and write** on this
repo (see the one-time setup above); if the push is refused, the check
fails and the diff is posted on the pull request with what to fix. If
Claude's own run fails, the run's summary in the Actions tab lists the
tool calls it was refused and its last message.

The `docs` check reports on every pull request: without code changes it
passes in a few seconds without running Claude, and on imports and
removals it shows as skipped, which also counts as passing. A run
normally takes under a minute and fails after 8; if it looks stuck longer
than that, GitHub is slow (its own Pages jobs slow down too), so reload
the page before re-running it. Both `preview` and `docs` can be required
before merging:
**Settings → Rules → Rulesets**, a branch ruleset on the default branch
with **Require status checks to pass** and those two checks.
