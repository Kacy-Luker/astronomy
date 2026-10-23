# Observing Log

Astronomy observations transcribed from paper notes, published at
<https://kacyluker.com/astronomy/>.

## Layout

| Path | What it holds |
| --- | --- |
| `data/sessions/` | One JSON file per observing session |
| `schema/session.schema.json` | The shape every session file must match |
| `scans/` | Original page scans |
| `site/` | Static site source (HTML, CSS, JS) |
| `scripts/` | Build and validation scripts |
| `docs/PROJECT_BRIEF.md` | The plan this site is built from |

## Local use

```sh
npm install
npm run validate   # check data/sessions against the schema
npm run build      # write the site to dist/
npm run serve      # build and preview locally
```

## Session files

Name each file `<date>-<site>.json` and set its `id` to the same slug,
for example `data/sessions/2026-09-11-act-observatory.json` with
`"id": "2026-09-11-act-observatory"`. Seeing and transparency use the
log sheet's I–V scale, stored as 1–5.

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
