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
rotation and fold position come from the notebook file's `scan` setting.
Use `redact` on a page to blur personal details such as a phone number.
Keep unredacted scans out of the repo, since it's public.

## Importing a session

After each observing session:

1. Scan the spreads you wrote on. Include the spread you started on even if
   part of it was imported before; already recorded entries aren't added again.
2. Upload the PDF (or image) to the private **astronomy-scans** repo as
   `<notebook id>/<date>.pdf`, for example `astronomy-001/2026-10-20.pdf`.
   Add a 24-hour time when you upload more than once a day:
   `astronomy-001/2026-10-20-1350.pdf`.
3. Here, open **Actions → Import session → Run workflow** and enter the
   notebook id. It picks the newest file in that notebook's folder. Tick
   **This was the last session in the notebook** when the notebook is full.
4. Review the pull request it opens: compare each session with its pages
   in the notebook view, fix anything misread in the JSON, then merge.
   Merge each import before running the next.

For a new notebook, the first upload should start at the inside front
cover so the front matter is recorded too.

The import splits the spreads into pages and asks Claude (Opus 5.5) to
read each one. Printed odd page numbers place the pages in the notebook;
if none are visible, the upload is placed after the last page with entries
and the pull request says so. It groups entries into sessions (a page
without a NEW SESSION header continues the last one) and blurs phone
numbers, emails and addresses. After blurring it checks each page again
and blurs the whole page if anything is still readable. Rescanned pages
get a new image, but only entries beyond those already recorded on the
page are added, so corrections made by hand survive. Expect roughly 5–10
cents per uploaded page.

A notebook's `status` is `in_progress` until an import is run with the
"last session" box ticked, which sets it to `completed` and fills in
`finished`. You can also change both by editing the notebook's JSON.

Locally, the same thing runs as:

```sh
ANTHROPIC_API_KEY=... node scripts/import-notebook.mjs astronomy-001 path/to/scan.pdf [--completed]
```

One-time setup:

1. Create a **private** repo named `astronomy-scans`.
2. Create a fine-grained token with read-only **Contents** access to
   `astronomy-scans` only.
3. In this repo, under **Settings → Secrets and variables → Actions**, add
   `SCANS_TOKEN` (that token) and `ANTHROPIC_API_KEY`.
4. Under **Settings → Actions → General**, tick **Allow GitHub Actions to
   create and approve pull requests**.

## Session files

Name each file `<date>-<site>.json` and set its `id` to the same slug,
for example `data/sessions/2026-10-11-okie-tex-2026.json` with
`"id": "2026-10-11-okie-tex-2026"`. Set `notebook` and `pages` to where
the session is written, and `page` on each observation. Seeing and
transparency use the log sheet's I–V scale, stored as 1–5; the notebook's
key reads seeing I as excellent and transparency I as magnitude 1.

## Hosting

Pushes to `main` build and deploy through GitHub Actions. The site is a
GitHub Pages project site, so it is served under the custom domain of the
`kacy-luker.github.io` user site at `/<repo name>/`. Keep the repo named
`astronomy` (lowercase) so the URL is `kacyluker.com/astronomy/`.

One-time setup: repo **Settings → Pages → Source**, choose
**GitHub Actions**. Leave **Custom domain** empty, and don't add DNS
records; the user site's domain already covers this path. Avoid an
`astronomy/` folder in the user site repo, since it would claim the
same path.

Asset and data paths in `site/` are relative so the site works under
that subpath.
