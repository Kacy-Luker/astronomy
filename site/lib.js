// Helpers shared by the site's pages.

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function formatDate(iso) {
  // Parse as a calendar date so the time zone can't shift the day.
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export async function loadSessions() {
  const res = await fetch("data/sessions.json");
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}
