# Observing Log

Astronomy observations transcribed from paper notes, published at
<https://astronomy.kacyluker.com>.

## Layout

| Path | What it holds |
| --- | --- |
| `data/sessions/` | One JSON file per observing session |
| `schema/session.schema.json` | The shape every session file must match |
| `scans/` | Original page scans |
| `site/` | Static site source (HTML, CSS, JS, `CNAME`) |
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

Pushes to `main` build and deploy through GitHub Actions. One-time setup:

1. Repo **Settings → Pages → Source**: choose **GitHub Actions**.
2. Same page, **Custom domain**: `astronomy.kacyluker.com`, then tick
   **Enforce HTTPS** once the certificate is issued.
3. At your DNS provider, add a `CNAME` record for `astronomy` pointing
   to `kacy-luker.github.io`.
