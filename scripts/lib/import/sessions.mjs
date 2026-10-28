// Sessions from the pages of an upload (step 5 of
// scripts/import-notebook.mjs). A header starts a session; entries without
// one continue the latest session, and entries above a NEW SESSION block
// partway down a page continue the session before it. On a page that
// already has entries, only entries beyond those are added (counted, not
// matched, so a misread can't duplicate one). Replacing pages starts them
// from scratch.
//
// sessions: every session by id (all notebooks), changed in place;
// notebook: the notebook's id; pages: the pages placed from the upload, in
// notebook order, as { name, number, reading } (name for the notes, e.g.
// "Uploaded page 03"); mode: the import's mode. Returns the ids of the
// sessions written (touched) and deleted (removed), and notes and the
// reader's spelling corrections for the PR summary.
const slug = (text) => text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const present = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));
// A reading's box as stored: [x, y, width, height], clamped to the page.
const boxOf = (b) => {
  if (!b) return null;
  const c = (v) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
  const [x, y] = [c(b.x), c(b.y)];
  return [x, y, c(Math.min(b.width, 1 - x)), c(Math.min(b.height, 1 - y))];
};
const lastPage = (s) => Math.max(0, ...(s.pages ?? []));
const headerFields = (h) => {
  const sky = present({ sqm: h.sqm, notes: h.sky_notes });
  return present({
    program: h.program,
    date: h.date,
    site: present({ name: h.site, lat: h.lat, lon: h.lon }),
    sky: Object.keys(sky).length ? sky : null,
    scope: h.scope && present(h.scope),
    observers: h.observers,
  });
};

export function recordSessions({ sessions, notebook, pages, mode }) {
  const notes = [];
  const corrections = []; // misspellings the reader corrected, for the summary
  const mine = () => [...sessions.values()].filter((s) => s.notebook === notebook);
  const touched = new Set();
  const removed = new Set();

  // Replacing pages starts them from scratch: forget their entries first.
  const processedNumbers = new Set(pages.map((p) => p.number).filter((n) => n != null));
  const startedOn = new Map(mine().map((s) => [Math.min(...(s.pages ?? [Infinity])), s]));
  if (mode === "replace") {
    for (const s of mine()) {
      const kept = s.observations.filter((o) => !processedNumbers.has(o.page));
      if (kept.length === s.observations.length) continue;
      s.observations = kept;
      s.pages = s.pages.filter((n) => !processedNumbers.has(n) || n === Math.min(...s.pages));
      touched.add(s.id);
    }
  }

  // Adds a page's entries to a session, noting the page.
  function addEntries(session, entries, number, withHeader = false) {
    if (number != null && !session.pages.includes(number) && (entries.length || withHeader)) {
      session.pages.push(number);
      session.pages.sort((a, b) => a - b);
    }
    for (const e of entries) {
      // Same field order as hand-written files; UT and magnification only when written.
      session.observations.push({
        catalog_id: e.catalog_id,
        aka: e.aka,
        ids: [e.catalog_id],
        page: number,
        local_time: e.local_time,
        ...present({ ut: e.ut }),
        seeing: e.seeing,
        transparency: e.transparency,
        eyepiece: e.eyepiece,
        ...present({ magnification: e.magnification }),
        filter: e.filter,
        description: e.description,
        ...present({ box: boxOf(e.box) }),
      });
    }
    if (entries.length) {
      session.observations.sort((a, b) => (a.page ?? 0) - (b.page ?? 0));
      touched.add(session.id);
    }
  }

  let current = null;
  for (const { name, number, reading: r } of pages) {
    if (r.kind !== "session" || (!r.header && !r.entries.length)) continue;
    const recorded = mine().flatMap((s) => s.observations).filter((o) => number != null && o.page === number).length;
    const added = r.entries.slice(recorded);
    // When a session starts partway down a page, the entries above its NEW
    // SESSION block continue the session before it.
    const above = r.header?.box ? added.filter((e) => e.box && e.box.y < r.header.box.y) : [];
    if (above.length) {
      const before = current ?? mine()
        .filter((s) => number == null || Math.min(...(s.pages ?? [Infinity])) < number)
        .sort((a, b) => lastPage(a) - lastPage(b))
        .at(-1);
      if (before) addEntries(before, above, number);
      else notes.push(`- ${name} has entries above its NEW SESSION block but no earlier session to belong to. They were skipped.`);
    }

    if (r.header) {
      current = number != null ? startedOn.get(number) : null;
      if (current && mode === "replace") {
        const { id: sid, notebook: nb, pages: ps, observations, header_box: oldBox, ...old } = current;
        const fresh = headerFields(r.header);
        const box = r.header.box ? { page: number, box: boxOf(r.header.box) } : oldBox;
        if (JSON.stringify(old) !== JSON.stringify(fresh) || JSON.stringify(box) !== JSON.stringify(oldBox)) {
          sessions.set(sid, { id: sid, ...fresh, notebook: nb, pages: ps, ...present({ header_box: box }), observations });
          current = sessions.get(sid);
          touched.add(sid);
        }
      }
      if (!current) {
        const h = r.header;
        let sid = slug(`${h.date}-${h.site}`);
        for (let n = 2; sessions.has(sid); n++) sid = slug(`${h.date}-${h.site}-${n}`);
        const box = number != null && h.box ? { header_box: { page: number, box: boxOf(h.box) } } : {};
        current = { id: sid, ...headerFields(h), notebook, pages: [], ...box, observations: [] };
        sessions.set(sid, current);
        touched.add(sid);
      }
    } else {
      current ??= mine()
        .filter((s) => number == null || lastPage(s) <= number)
        .sort((a, b) => lastPage(a) - lastPage(b))
        .at(-1) ?? null;
      if (!current) {
        notes.push(`- ${name} has entries but no session to belong to. They were skipped.`);
        continue;
      }
    }
    addEntries(current, added.filter((e) => !above.includes(e)), number, Boolean(r.header));
    if (added.length) for (const note of r.uncertain) notes.push(`- ${current.id}, page ${number ?? "?"}: ${note}`);
    if (added.length) for (const fix of r.corrections ?? []) corrections.push(`- ${current.id}, page ${number ?? "?"}: ${fix}`);
  }
  for (const s of mine()) {
    if (touched.has(s.id) && !s.observations.length) {
      sessions.delete(s.id);
      touched.delete(s.id);
      removed.add(s.id);
    }
  }
  return { touched, removed, notes, corrections };
}
