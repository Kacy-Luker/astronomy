# Project brief

The plan this site is built from. Each numbered item in the PR plan
lands as its own pull request.

```text
Build an astronomy observation-log website in this repo
(Kacy-Luker/Astronomy), hosted on GitHub Pages at
kacyluker.com/astronomy (served under the kacy-luker.github.io
user site's custom domain; no CNAME here). Static site, no server.

RULES
- One PR per feature, opened against main.
- Logical commits, short commit messages.

SOURCE MATERIAL
Scans of paper observing notes using a printed template. Header:
program, date, site, lat/long, sky/SQM, scope, observer. Per object:
catalog #, AKA, local time, UT, seeing I-V, transparency I-V,
eyepiece/mag, filter, sketch circle, description.

REQUIREMENTS
- Search across any field: catalog, object ID, common name, location,
  date, equipment (telescope, eyepiece, filter), observer, program.
- Auto-generate JSON from the handwriting.
- Add cross-catalog IDs beyond the one used that night
  (M51 -> NGC 5194, etc.), from the OpenNGC dataset.
- Each session shows the original scan in true color plus an
  inverted (black/white swapped) version.
- Adding a page must be really easy. Correcting JSON must be easy.

ARCHITECTURE
- Add a page: drop a scan in inbox/ and push (or upload via the
  GitHub web UI).
- GitHub Action sends the scan to the Claude API (secret:
  ANTHROPIC_API_KEY), writes session JSON, generates the inverted
  image, enriches cross-IDs, and opens a PR for review.
- Each session page has an "Edit" button opening its JSON in
  GitHub's web editor. CI validates JSON against a schema.
- Client-side search index (MiniSearch) built at deploy time.

PR PLAN
1. Scaffold, JSON schema, Pages config
2. Session viewer with original/inverted image toggle
3. Search across all fields
4. Inbox Action: scan -> Claude transcription -> JSON
5. Cross-ID enrichment (Messier, NGC, IC, common names)
6. Edit-JSON links + schema validation in CI
7. Docs for adding pages

SAMPLE SESSION JSON
{
  "program": "Messier",
  "date": "2026-09-11",
  "site": "ACT Observatory",
  "lat": 35.831, "lon": -96.147,
  "sqm": 20.89,
  "scope": {"name": "Orion XT8", "type": "Dobsonian",
    "aperture_mm": 203, "focal_length_mm": 1200, "f_ratio": 5.9},
  "observer": "Kacy Luker",
  "observations": [
    {"catalog_id": "M51", "aka": "Whirlpool Galaxy",
     "ids": ["M51", "NGC 5194", "NGC 5195"],
     "local_time": "20:50", "seeing": 3, "transparency": 4,
     "eyepiece": "21mm Ethos", "filter": null,
     "description": "2 bright cores with a dimmer halo; halos overlap; larger is top right of eyepiece"},
    {"catalog_id": "M87", "aka": null,
     "ids": ["M87", "NGC 4486"],
     "local_time": "23:15", "seeing": 2, "transparency": 4,
     "eyepiece": "21mm Ethos", "filter": null,
     "description": "Bright core with a few distinct stars; dim halo with less dusty star distribution than core"}
  ]
}

Start with PR 1 only.
```
