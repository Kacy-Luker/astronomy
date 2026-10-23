# Observing Log

Astronomy observations transcribed from paper notes, published at
<https://kacyluker.com/astronomy/>.

## Layout

| Path | What it holds |
| --- | --- |
| `data/notebooks/` | One JSON file per paper notebook, listing every page |
| `data/sessions/` | One JSON file per observing session |
| `schema/` | The shape every notebook and session file must match |
| `scans/<notebook>/` | One image per notebook page, in order (`01.jpg`, `02.jpg`, …) |
| `site/` | Static site source (HTML, CSS, JS) |
| `scripts/` | Build and validation scripts |
| `docs/PROJECT_BRIEF.md` | The plan this site is built from |
| `CLAUDE.md` | Context for AI agents working on the repo |

## Local use

```sh
npm install
npm run validate   # check notebooks and sessions against the schemas
npm run build      # write the site to dist/
npm run serve      # build and preview locally
```

## Notebooks

Each paper notebook has a file like `data/notebooks/astronomy-001.json`
that lists every scanned page in order: covers, title, index, reference,
session pages, and blanks. Page numbers are printed on odd pages; even
ones are inferred. Front matter has a label instead of a number.

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
**Actions → Import → Run workflow** here, choose an action, and review the
pull request it opens before merging. Merge each import before the next.

| Action | When | Scan |
| --- | --- | --- |
| **Create new notebook** | Starting a notebook | From the inside front cover through any sessions so far. Pick **new-notebook** in the notebook dropdown and type the id in **new notebook** |
| **Add session** | After each session | The spreads you wrote on, including the one you started on. Only new pages and pages still being written on are read |
| **Replace pages** | A page was misread or rescanned | The spreads to re-read. What was recorded for those pages is replaced |
| **Complete notebook** | The notebook is full | Run once with no scan to mark it completed and get the list of spreads to rescan; then upload those, in that order, and run it again with that file |
| **Remove notebook** | Taking a notebook off the site | No scan. Type the notebook's id in **confirm**; it opens a pull request deleting the notebook, its page images and its sessions (the scans in astronomy-scans are kept) |

The scan field can be left empty to use the newest file in the notebook's
folder (for **Complete notebook**, empty means no scan). The notebook
dropdown is generated from `data/notebooks/` by
`scripts/sync-workflow.mjs`; a new notebook appears in it once its import
is merged.

**Open pages.** Pages that will still change are marked `"open": true`:
the index, a volume label with no finish date, blank pages after the last
one written on, and session pages with room for another entry. Open pages
are re-read by **Add session**, and all but session pages are hidden on
the site until the notebook is completed.

**How it reads.** The import splits each spread into pages and asks
Claude (Opus 5.5) to read them. Pages are placed by their printed odd
page numbers, by matching rescanned pages against the published ones, or
for completion by the rescan list. Entries are grouped into sessions (a
page without a NEW SESSION header continues the last one); on a page that
already has entries, only entries beyond those are added, so nothing is
duplicated and hand corrections survive. Phone numbers, emails and
addresses are blurred, and each blurred page is checked again; if anything
is still readable the whole page is blurred. Expect roughly 5–10 cents per
page read.

Locally, the same thing runs as:

```sh
ANTHROPIC_API_KEY=... node scripts/import-notebook.mjs astronomy-001 path/to/scan.pdf --mode add
```

One-time setup:

1. Create a **private** repo named `astronomy-scans`.
2. Create a fine-grained token with access to `astronomy-scans` (Contents:
   read-only) and to this repo (Contents, Pull requests and Workflows:
   read and write). Workflows access lets an import update the notebook
   dropdown.
3. In this repo, under **Settings → Secrets and variables → Actions**, add
   the repository secrets `SCANS_TOKEN` (that token) and `ANTHROPIC_API_KEY`.

## Show-through

Rubber-stamp ink soaks through the paper and shows as a faint mirrored
ghost on the other side of the sheet; pencil doesn't.
`scripts/showthrough.py` removes those ghosts and writes a cleaned copy,
`scans/<id>/NN.clean.jpg`, beside each page it can clean:

1. Pages pair by printed number (odd page N is backed by page N + 1;
   unnumbered front matter pairs by position).
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

## Session files

Name each file `<date>-<site>.json` and set its `id` to the same slug,
for example `data/sessions/2026-10-11-okie-tex-2026.json` with
`"id": "2026-10-11-okie-tex-2026"`. Set `notebook` and `pages` to where
the session is written, and `page` on each observation. Seeing and
transparency use the log sheet's I–V scale, stored as 1–5; the notebook's
key reads seeing I as excellent and transparency I as magnitude 1.

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

### Pull request previews

Every pull request, including import PRs, is built and published at
`kacyluker.com/astronomy/pr-preview/pr-<number>/`, with a banner saying
it's a preview. A comment on the PR links to it and updates on each push.
The preview is removed when the PR is merged or closed. The main deploy
leaves `gh-pages/pr-preview/` alone.
