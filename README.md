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

## Importing a notebook

When a notebook is full (or whenever you want to catch up):

1. Scan every spread, cover to last page, into one PDF.
2. Upload it to the private **astronomy-scans** repo as `<notebook id>.pdf`,
   for example `astronomy-002.pdf`.
3. Here, open **Actions → Import notebook → Run workflow** and enter the
   notebook id.
4. Review the pull request it opens: compare each session with its pages
   in the notebook view, fix anything misread in the JSON, then merge.

The import splits the pages and asks Claude (Opus 5.5) to read each one.
It numbers the pages, groups entries into sessions, and blurs phone
numbers, emails and addresses. After blurring it checks each page again
and blurs the whole page if anything is still readable. Pages the notebook
file already lists are left alone, so re-importing a notebook you've added
to only reads the new pages and keeps your corrections. Expect roughly
5–10 cents per new page.

Locally, the same thing runs as:

```sh
ANTHROPIC_API_KEY=... node scripts/import-notebook.mjs astronomy-002 path/to/scan.pdf
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
