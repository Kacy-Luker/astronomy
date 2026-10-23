// Helpers shared by the site's pages.

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function link(href, text, className) {
  const a = el("a", className, text);
  a.href = href;
  return a;
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

async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

export const loadSessions = () => loadJSON("data/sessions.json");
export const loadNotebooks = () => loadJSON("data/notebooks.json");

export const sessionHref = (id) => `session.html?id=${encodeURIComponent(id)}`;
export const notebookHref = (id, page) =>
  `notebook.html?id=${encodeURIComponent(id)}${page ? `#${pageAnchor(page)}` : ""}`;

// Numbered pages anchor by number; front matter by its position in the scan.
export function pageAnchor(page) {
  return page.number != null ? `p${page.number}` : `scan-${page.slot}`;
}

export const KIND_NAMES = {
  cover: "Cover", title: "Title page", index: "Index", reference: "Reference",
  session: "Session", unused: "Unused", blank: "Blank", contents: "Table of contents",
  info: "Notebook info",
};

export function pageName(page) {
  return page.number != null ? `Page ${page.number}` : page.label ?? KIND_NAMES[page.kind];
}

// The notebook's own key. Seeing I is best; transparency I is worst.
const ROMAN = ["I", "II", "III", "IV", "V"];
const SEEING = ["Excellent", "Very good", "Good", "Fair", "Poor"];
const TRANSPARENCY = ["Mag 1", "Mag 2–3", "Mag 4", "Mag 5", "Mag 6–7"];

export const seeingText = (n) => n && `${ROMAN[n - 1]} · ${SEEING[n - 1]}`;
export const transparencyText = (n) => n && `${ROMAN[n - 1]} · ${TRANSPARENCY[n - 1]}`;

// How scans are shown: inverted (white on dark; the default), cleaned (stamp
// show-through removed), or the original scan. Inverted uses the cleaned
// image. The viewer's last choice is remembered; storage can be unavailable.
const VIEWS = { inverted: "Inverted", cleaned: "Cleaned", original: "Original" };
const VIEW_KEY = "page-view";
function savedView() {
  try { return localStorage.getItem(VIEW_KEY); } catch { return null; }
}
function saveView(view) {
  try { localStorage.setItem(VIEW_KEY, view); } catch { /* not persisted */ }
}
let currentView = VIEWS[savedView()] ? savedView() : "inverted";

const imageFor = (img, view) => (view === "original" ? img.dataset.original : img.dataset.clean || img.dataset.original);

// Inverted / Cleaned / Original buttons for the scans inside target.
export function scanToggle(target) {
  const group = el("div", "toggle");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "How scans are shown");
  const buttons = Object.entries(VIEWS).map(([view, label]) => {
    const b = el("button", null, label);
    b.type = "button";
    b.dataset.view = view;
    b.addEventListener("click", () => { apply(view); saveView(view); });
    return b;
  });
  function apply(view) {
    currentView = view;
    target.classList.toggle("inverted", view === "inverted");
    for (const img of target.querySelectorAll("img[data-original]")) {
      img.src = imageFor(img, view);
      img.closest("a").href = img.src;
    }
    for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.view === view));
  }
  apply(currentView);
  group.append(...buttons);
  return group;
}

// One scanned page, linking to the full image, with a caption.
export function pageFigure(page, alt, caption) {
  const figure = el("figure", "page");
  figure.id = pageAnchor(page);
  const img = el("img");
  img.dataset.original = page.image;
  if (page.clean) img.dataset.clean = page.clean;
  img.src = imageFor(img, currentView);
  const a = link(img.src);
  if (page.width) [img.width, img.height] = [page.width, page.height];
  img.alt = alt;
  img.loading = "lazy";
  a.append(img);
  figure.append(a);
  if (caption) {
    const fc = el("figcaption");
    fc.append(...[caption].flat());
    figure.append(fc);
  }
  return figure;
}
