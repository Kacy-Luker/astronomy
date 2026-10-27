// Page numbers for the pages of an upload (step 3 of
// scripts/import-notebook.mjs). Odd pages carry printed numbers, which
// always win; the others follow from them by where they are in the upload.
// Only when no printed number was read does the start page number the
// session pages, in scan order (a printed number can be missed while
// scanning). A blank page only gets a number when it comes before a session
// page, or faces one.
//
// uploads: the upload indexes being placed, in scan order; readingOf(u):
// Claude's reading of upload u (undefined if it wasn't read); kindOf(u): the
// category it's placed in. Returns numberOf(u), and notes for the PR summary.
const nn = (i) => String(i + 1).padStart(2, "0");

export function numberPages({ uploads, readingOf, kindOf, startPage = null }) {
  const notes = [];
  const votes = new Map();
  for (const u of uploads) {
    const n = readingOf(u).printed_number;
    if (n % 2 === 1) votes.set(n - u, (votes.get(n - u) ?? 0) + 1);
  }
  const isSession = (u) => readingOf(u) != null && ["session", "unused"].includes(kindOf(u));
  const firstSession = uploads.find(isSession);
  let offset = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (startPage != null) {
    if (firstSession == null) notes.push(`- A start page (${startPage}) was given, but the scan has no session pages, so it wasn't used.`);
    else if (offset != null) {
      const printed = firstSession + offset;
      notes.push(`- Printed page numbers were read, so the start page wasn't needed` +
        (printed !== startPage ? `: they make the first session page ${printed}, not ${startPage}. Check the scan.` : "."));
    } else {
      offset = startPage - firstSession;
      notes.push(`- No printed page numbers were read, so session pages were numbered from ${startPage}, the start page given, in scan order.`);
    }
  }
  const sessionArea = (u) => isSession(u) || (readingOf(u) != null && readingOf(u).printed_number != null);
  function numberOf(u) {
    const r = readingOf(u);
    if (r.printed_number != null) return r.printed_number;
    if (offset == null || u + offset < 1) return null;
    if (kindOf(u) === "blank" && !isSession(u + 1) && !sessionArea(u ^ 1)) return null;
    return ["session", "unused", "blank"].includes(kindOf(u)) ? u + offset : null;
  }
  for (const u of uploads) {
    const n = readingOf(u).printed_number, want = offset != null ? u + offset : null;
    if (n != null && want != null && n !== want) notes.push(`- Uploaded page ${nn(u)} shows number ${n}, out of step with the pages around it. Check the page order.`);
  }
  return { numberOf, notes };
}
