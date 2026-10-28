# Observing Log

Astronomy observations transcribed from paper notes, published at
<https://kacyluker.com/astronomy/>.

## Layout

| Path | What it holds |
| --- | --- |
| `data/notebooks/` | One JSON file per paper notebook, listing every page |
| `data/sessions/` | One JSON file per observing session |
| `data/objects.json` | Catalog info for every observed object, from OpenNGC and SIMBAD (generated) |
| `data/personalObjectMappings.json` | Objects you take differently from the catalogs (edit by hand) |
| `schema/` | The shape every notebook and session file must match |
| `scans/<notebook>/` | One image per notebook page, in order (`01.jpg`, `02.jpg`, …) |
| `test-data/` | Made-up notebooks and sessions for the test site, laid out like `data/`, with drawn page images in `test-data/scans/` |
| `site/` | Static site source (HTML, CSS, JS) |
| `site/icons/` | Site icons from Kacy's telescope photos: a wide crop at 16 and 32 px, a close-up at 180, 192 and 512 px (the larger ones also listed in `site/manifest.webmanifest`, with wider "maskable" crops that fill Android's home-screen tile) |
| `scripts/` | Build and validation scripts |
| `tests/` | `npm test`: unit tests (`tests/unit/`) and the site tests (`site.spec.mjs`, run by `playwright.config.mjs`) |
| `docs/PROJECT_BRIEF.md` | The plan this site is built from |
| `docs/DEPENDENCIES.md` | Every outside service (Claude, catalogs, image tools, GitHub) and what a replacement must do |
| `CLAUDE.md` | Context for AI agents working on the repo |

## Local use

```sh
npm install
npm run validate   # check data against the schemas and page order, and the forms' dropdowns
npm run build      # write the site to dist/
npm run serve      # build and preview locally
npm test           # unit tests, then the site tests in Chromium (see Tests)
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
| Inside front cover | `inside_front_cover` | never shown | never shown | yes |
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

The import (below) turns each scan, a PDF of two-page spreads or a folder
of images, into page images: it rotates each spread upright, cuts it at
the fold, blurs any `redact` boxes, and writes
`scans/astronomy-001/01.jpg`, `02.jpg`, and so on. The fold is found in
each spread (a faint crease that runs the page's height, cut where it
won't go through writing), since scanner placement moves it; a spread
with no visible fold uses the median of the others, or the notebook
file's `scan.split` when none can be seen.
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
| Start a notebook | **new-notebook** | The closed notebook (its front cover), then the inside front cover through any sessions so far, in a new folder named for the notebook, e.g. `astronomy-002/`. The folder name becomes the notebook's id. Pick its kind in **notebook type** |
| Re-read pages | the notebook, and tick **reread** | The spreads to re-read, for a misread page or a rescan. What was recorded for those pages is replaced |
| Add the front cover | the notebook, and **Front cover** as the category | The closed notebook on the scanner, on its own. The scanner lid is trimmed off and the cover turned upright; run it again to replace it. A scan of the closed notebook among the spreads of any import is found and used as the cover too |

| Form | When | Scan |
| --- | --- | --- |
| **Complete notebook** | The notebook is full | Run once with no scan to mark it completed and get the rescan checklist; then scan the spreads it lists, in any order, into one file and run it again with that file. Scan the closed notebook in the same file, or on its own with **Import** and **Front cover** |
| **Remove notebook** | Taking a notebook off the site | No scan. Type the notebook's id in **confirm**; it opens a pull request deleting the notebook, its page images and its sessions (the scans in astronomy-scans are kept) |

The scan field can be left empty to use the newest file in the notebook's
folder; for a new notebook, that's the one folder with no notebook yet
(type the path if there's more than one). For **Complete notebook**, empty
means no scan. The notebook and category dropdowns are generated from
`data/notebooks/` and `data/categories.json` by
`scripts/sync-workflow.mjs`; a new notebook appears in them once its
import is merged.

**Notebook type.** A new notebook's kind, from `data/notebook-types.json`:
how it's scanned (spreads or single sheets, which way up, where the fold
usually is), how its pages are numbered, and what they're written on.
There are two:
- **Stamped log, spreads**: this notebook, at any page size, with the
  rubber-stamped form.
- **Free-text log, spreads** (#109): no stamp. Each session starts at a
  date heading, and Claude picks the same fields out of what's written
  about each object; anything not written is a to-do, as on the stamp.
  Its pages aren't show-through-cleaned (the cleaner works from the
  stamp's ink), so the Cleaned view shows them as scanned.

The notebook keeps the type it was made with (its `type`; one without is
the first type), so the field only matters for **new-notebook**. A kind
the import can't read yet (single sheets) isn't offered in the form.
Page images are 1600 px tall whatever the paper size. All three forms
share their steps through `.github/workflows/notebook-job.yml`, and run
one at a time.

**Start page.** Session pages are placed by the page numbers printed on
odd pages, and a printed number always wins: if any page in the scan shows
one, the others are counted from it. If none came out in the scan, the
number in **start page** is used instead: the scan's first session page
gets it and the rest are numbered in scan order (a blank page just before
them counts too). A start page that disagrees with printed numbers is
noted in the pull request. A start page makes an import read every page
in the scan.

**Open pages.** Pages that will still change are marked `"open": true`:
the table of contents, blank pages after the last one written on, and
session pages with room for another entry. Open pages are re-read by the
next import, and all but session pages are left off the site until the
notebook is completed.

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
nothing is duplicated and hand corrections survive. Claude fixes plain
misspellings and writes names in normal capitals rather than as printed;
the pull request lists each spelling it corrected. Phone numbers, emails
and addresses are blurred, and each blurred page is checked again; if
anything is still readable the whole page is blurred. Each import's pull
request says how many tokens Claude used; the cost is those times
[Anthropic's prices per token](https://docs.claude.com/en/docs/about-claude/pricing)
for the model in `scripts/lib/readers/claude.mjs`.

Locally, the same thing runs as:

```sh
ANTHROPIC_API_KEY=... node scripts/import-notebook.mjs astronomy-001 path/to/scan.pdf --mode add
```

`--mode` is `new`, `add`, `replace` or `complete`; `--category`,
`--start` and `--type` are the form's category, start page and notebook
type. A front cover is
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

## Searching

The home page's search box narrows every tab to the observations that
match: every word has to appear somewhere in an observation or its
session, ignoring case and accents. That covers the object's designations
(`NGC 5194` or `ngc5194` finds M51), names, type and constellation, the
date (`2026-10-11`, `Oct 11`, `october`), site and coordinates, telescope,
eyepiece, filter, magnification, seeing and transparency, observers,
program, notebook and page, and the description. Sessions list only their
matching objects; their to-do count is still the whole session's. The
search is kept in the address (`?q=andromeda`), so it can be bookmarked or
shared and survives switching tabs.

**Filters** sit beside the search box on every page that lists more than
one thing to narrow (a session with one observation, a notebook with one
session or an object seen once has no bar). Tap **Filters** for a
dropdown per field (program, catalog, site, telescope, eyepiece, filter,
observer, notebook, seeing, transparency) with the values on that page; a
field with only one value there isn't shown. Sites are listed without
their years (Okie-Tex 2026 and 2027 are both Okie-Tex); use the date range
for one year. There's also a date range (with more than one night),
**Has to-dos** and **Favorites only** (each when only some have them).
Active filters show as chips: tap one to remove it, or **Clear all**.
They're in the address too
(`?site=Okie-Tex&eyepiece=13mm+Ethos`), and links between pages keep
them. The home page narrows its tabs; a session page dims the observations
outside them; an object page shows only the matching observations and
sketches; a notebook page dims the sessions in its contents with nothing
matching.

## Favorites

Mark your favorite observation of an object in admin mode: each
observation on an object page has a star (☆, or ★ for the favorite).
Tapping it opens a ready-made GitHub issue ("Favorite: M31 on Oct 11,
2026"); tap **Submit** and the **Favorite** workflow opens a pull request
setting it and links it on the issue. The pull request merges itself once
its checks pass (the workflow validates the data and refuses any change
outside the session files, then the `preview` and `docs` checks run), and
the issue closes with it. This needs **Settings → General → Allow
auto-merge** on; without it, merge the pull request yourself.
An object has one favorite: a new one replaces the old. Tap ★ to clear it
the same way. Only issues you open are acted on. The favorite is stored as
`"favorite": true` on the observation. Its sketch is shown first on the
object page (★ on its session button, a **★ Favorite** tag on its card)
and used for the object's thumbnail on the Sketches tab, and the Filters
panel gets **Favorites only** once some observations are favorites and
some aren't. By hand: `node scripts/favorite.mjs <session id>
<observation number> [--off]`.

## Equipment

The home page's **Equipment** tab lists every telescope (with its type,
aperture, focal length and f-ratio), eyepiece (with the magnifications
used, when written) and filter used, each with how many observations it
was used for, most used first. Filters written N/A are counted as **No
filter**. Names written slightly differently (`13mm Ethos`, `13 mm ethos`)
count as one, shown in the spelling used most; the filters treat them as
one too. Tap a name to see those observations on the Sessions tab. The
counts follow the search and filters.

## Map

The home page's **Map** tab shows a marker for each observing site, with
how many observations were made there. Tap one for a summary that stays
small however often you observe there: the site without its year (Okie-Tex
2026 and 2027 are both Okie-Tex), its observations and sessions, the
first and last dates, and a link to the Sessions tab filtered to that
site. When several sites share a spot, the newest two get a link each,
and **See all N sessions here** opens the Sessions tab with every session
at that spot (a **Near** chip, named for the newest site there).
It uses each session's lat/long, rounded to 0.1° (about 10 km) so the map
never shows exactly where you observe from; session pages still show the
coordinates as written. Sessions without coordinates are listed under the
map. The map opens on your sites in the USA (the lower 48 states); sites
elsewhere stay on it, and the note under it says how many to zoom out
for. When only sites abroad match the search, it fits those. The counts
follow the search and filters. The map is
[Leaflet](https://leafletjs.com/) (installed from npm and served with the
site) on [OpenStreetMap](https://www.openstreetmap.org/) tiles, credited
on the map.

## Session files

**Admin mode.** Open any page of the site with `?admin=on` at the end of
the address (for example `kacyluker.com/astronomy/?admin=on`); the
browser remembers it. Every page then has an admin bar across the top
(under the preview bar on a PR preview) with a short phone how-to
(`help.html`: adding a session, other imports, finishing and removing a
notebook), an **Edit links** toggle, and a link to leave admin mode
(`?admin=off`). With Edit links on, pages show links that open the file
in GitHub's editor: **Edit session** and an **Edit** on each observation (the session's
file), **Edit notebook**, and **Edit mappings** on object pages. Visitors
never see any of it. It works on PR previews too, where the Edit links
open the pull request's branch instead of main.

In the installed app (below) there's no address bar. On Android the app
shares Chrome's storage, so open `kacyluker.com/astronomy/?admin=on` once
in Chrome and the app is in admin mode too. After that, a device that has
been in admin mode shows an **Admin mode** link at the bottom of every
page while it's off, to turn it back on from inside the app (#112).

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
mapped to (`to`), and `why`. An object written as `from` is looked up as
`to`, so its info and other designations come from the `to` object, and
`from` is added to them. M102 is mapped to NGC 5866 (the Spindle
Galaxy), rather than OpenNGC's duplicate of M101. Catalogs are Messier,
NGC, IC, Caldwell, or another catalog's prefix. Edit it on GitHub, then
run `node scripts/enrich-ids.mjs` (or the next import) to update the
sessions. Every page's footer credits the catalog databases the objects
came from and links this file.

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
OpenNGC doesn't cover (stars and double stars like Albireo, Barnard and
Abell objects, Sharpless regions, Melotte and Stock clusters) are looked
up in [SIMBAD](https://simbad.cds.unistra.fr/) (CDS, Strasbourg) during
the import, by any name SIMBAD knows (Albireo, beta Cyg, Abell 426).
SIMBAD gives no constellation. If SIMBAD can't be reached, those objects
are left as written until the next import. Planets aren't in either and
stay as written. The home page's Sketches tab shows one catalog at
a time, picked with a toggle, and lists every observed object under each
catalog it's in (M31 under Messier and NGC), in catalog order, with a
thumbnail of its favorite or latest sketch (just the sketch circle, found
automatically), its latest observation and a count when there are more.
Tapping an object opens its page (`object.html?id=M31`): the catalog
info, its sketch, shown as the session's NEW SESSION block and the entry,
two images with a gap (a toggle picks the session when there are
several), and every observation of it, newest first. A session page
shows its NEW SESSION block at the top and each observation's entry on
its card, in the same view as the pages.

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
it's a preview. A comment on the PR links to it in admin mode
(`?admin=on`), so it opens with the admin bar and its data switch, and
updates on each push.
The preview is removed when the PR is merged or closed. The main deploy
leaves `gh-pages/pr-preview/` alone.

### Test site

`kacyluker.com/astronomy/test/` is the site with made-up test data, for
trying features your own notebooks don't use yet: an object seen four
times under different designations (M31 / NGC 224), Messier, NGC, IC,
Caldwell and non-catalog objects (Albireo, Saturn, the Large Magellanic
Cloud), a southern-sky session in Australia, a completed notebook
with its contents and index, N/A and blank fields, a crossed-out page, two
sessions on one page, a session without coordinates, a favorite, and three
sites at one map spot (Okie-Tex in two years, Camp Billy Joe and Black
Mesa, for the Near link). Every merge to `main` deploys it alongside the live
site, so it's never out of date.

Its banner says **Test site**. In admin mode the admin bar has a
**Showing real data | test data** switch, on every site:
- **Test site and PR previews:** they carry both datasets, so it switches
  in place. Previews show real data by default.
- **Live site:** it has only your data, so **test data** opens the same
  page on the test site.

The choice goes in the address (`?data=test`), links keep it, and your
browser remembers it. Visitors never see the switch. Favorite stars are
hidden while showing test data, since favorites only change the real data.

The test data lives in `test-data/` (notebooks, sessions and
`objects.json`, checked by `npm run validate` like `data/`). Its page
images are drawn by `node scripts/make-test-pages.mjs` (plus unblurred
title pages in `test-data/unblurred/` for the import test, never
published), which also writes
each session's `header_box` and boxes; run it after editing the test
notebooks or sessions, and commit the images. They're made up, with a
fake phone and email on the blurred title pages, so nothing in them is
yours.

### Tests

`npm test` (and the **Test** check on every pull request and push to
`main`) runs:

- **Unit tests** (`tests/unit/`, Node's test runner): catalog designations,
  lookups and your mappings (with stand-in catalogs, nothing fetched), page
  order, the JSON layout, to-dos, site names without years, map spots,
  and a privacy check that every `redact` box on every published page
  image, yours and the test data's, is still blurred.
- **Import test** (`tests/import.test.mjs`): Test Notebook 2's drawn
  pages, put back into sideways two-page spreads, go through the real
  import in a scratch folder, with Claude's readings written by hand from
  the test data (no API key, no catalog lookups). A new import of the
  first four spreads, then an add with a rescan and a new spread, must
  give back the test data's notebook and sessions, skip the rescanned
  pages and blur the title page. Test Notebook 3, written without the
  stamp, goes through a new import as a free-text notebook the same way.
- **Site tests** (`tests/site.spec.mjs`, Playwright in Chromium) against
  the test site's build, at phone and desktop width: every page loads with
  no errors, failed requests or sideways scroll; the admin bar's real/test switch;
  to-dos, N/A and the seeing and transparency words; one object under two
  designations; the Sketches toggle and the back button; the scan view
  being remembered; search and filters; and the map's Near link. Expected
  values come from the test data where they can.

When a site test fails on GitHub, its screenshots are kept with the run
(**test-results** under the run's summary) for a week. To make **Test**
required, add it next to `preview` and `docs` in the branch rules.

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
