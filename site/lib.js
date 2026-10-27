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
// Catalog info by object (data/objects.json); empty when there is none.
export const loadObjects = () => loadJSON("data/objects.json").then((d) => d.objects, () => ({}));

export const sessionHref = (id) => `session.html?id=${encodeURIComponent(id)}`;
export const objectHref = (id) => `object.html?id=${encodeURIComponent(id)}`;
export const notebookHref = (id, page) =>
  `notebook.html?id=${encodeURIComponent(id)}${page ? `#${pageAnchor(page)}` : ""}`;

// Numbered pages anchor by number; front matter by its position in the scan.
export function pageAnchor(page) {
  return page.number != null ? `p${page.number}` : `scan-${page.slot}`;
}

// Category labels come with the pages (data/categories.json); these are the
// kinds that aren't categories.
export const KIND_NAMES = { session: "Session", unused: "Unused", blank: "Blank" };

export function pageName(page) {
  return page.number != null ? `Page ${page.number}` : page.label ?? KIND_NAMES[page.kind] ?? page.kind;
}

// Kacy circles I–V using the Clear Sky Chart's words, with seeing I as the
// best (as on the Antoniadi scale) and transparency V as the best.
const ROMAN = ["I", "II", "III", "IV", "V"];
const SEEING = ["Excellent", "Good", "Average", "Poor", "Bad"];
const TRANSPARENCY = ["Poor", "Below average", "Average", "Above average", "Transparent"];

// An object's name: as written on the sheet (AKA), else the catalog's.
export const objectName = (o) => o.aka || o.catalog?.name || null;

// "Planetary nebula in Vulpecula · mag 7.4 · 6.7′", from the build's
// catalog info (data/objects.json, OpenNGC).
export function catalogText(c) {
  if (!c) return null;
  const what = c.constellation ? `${c.type} in ${c.constellation}` : c.type;
  return [what, c.magnitude != null && `mag ${c.magnitude}`, c.size].filter(Boolean).join(" · ");
}

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

// Tapping a page opens it full size in view.html, in the same view: the
// inversion is a style here, so the bare image file would show un-inverted.
const viewerHref = (img, view) =>
  `view.html?${new URLSearchParams({ img: imageFor(img, view), view, name: img.dataset.name ?? "" })}`;

// Show the images inside target in a view (default: the viewer's last one).
export function applyView(target, view = currentView) {
  target.classList.toggle("inverted", view === "inverted");
  for (const img of target.querySelectorAll("img[data-original]")) {
    img.src = imageFor(img, view);
    const a = img.closest("a[data-viewer]");
    if (a) a.href = viewerHref(img, view);
  }
}

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
    applyView(target, view);
    for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.view === view));
  }
  apply(currentView);
  group.append(...buttons);
  return group;
}

// One scanned page, linking to the full image, with a caption.
export function pageFigure(page, alt, caption) {
  const figure = imageFigure(page, alt, caption);
  figure.id = pageAnchor(page);
  return figure;
}

// Any image with an original and a cleaned copy ({ image, clean, width,
// height }: a page or a sketch), linking to the viewer, with a caption.
export function imageFigure(page, alt, caption) {
  const figure = el("figure", "page");
  const img = el("img");
  img.dataset.original = page.image;
  if (page.clean) img.dataset.clean = page.clean;
  img.src = imageFor(img, currentView);
  img.dataset.name = alt;
  const a = link(viewerHref(img, currentView));
  a.dataset.viewer = "";
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

// Admin mode is for Kacy: turned on by opening any page with ?admin=on
// (?admin=off turns it off), which this browser remembers, and never on PR
// previews. It adds an admin bar to the footer with a toggle for the Edit
// links, which open a data file in GitHub's web editor.
const REPO = "https://github.com/Kacy-Luker/astronomy";
const ADMIN_KEY = "observing-log-admin";
const EDIT_KEY = "observing-log-edit";
function stored(key) {
  try { return localStorage.getItem(key) === "on"; } catch { return false; }
}
function store(key, on) {
  try {
    if (on) localStorage.setItem(key, "on");
    else localStorage.removeItem(key);
  } catch { /* not remembered */ }
}
const adminParam = new URLSearchParams(location.search).get("admin");
if (adminParam === "on" || adminParam === "off") store(ADMIN_KEY, adminParam === "on");
export const adminMode = adminParam !== "off" && (adminParam === "on" || stored(ADMIN_KEY)) &&
  !document.querySelector(".preview-banner");
export const editMode = adminMode && stored(EDIT_KEY);

// A link to edit a file in the repo (e.g. data/sessions/<id>.json), or null
// when the Edit links are off.
export const sessionFile = (id) => `data/sessions/${id}.json`;
export function editLink(path, text = "Edit") {
  if (!editMode) return null;
  const a = link(`${REPO}/edit/main/${path}`, text, "edit-link");
  a.title = `Edit ${path} on GitHub`;
  return a;
}

if (adminMode) {
  const footer = document.querySelector(".site-footer") ?? document.body.appendChild(el("footer", "site-footer muted"));
  const bar = el("p", "admin-bar", "Admin · ");
  // The Edit links are drawn as the page loads, so switching reloads it.
  const toggle = el("button", "admin-toggle", `Edit links: ${editMode ? "on" : "off"}`);
  toggle.type = "button";
  toggle.setAttribute("aria-pressed", String(editMode));
  toggle.addEventListener("click", () => { store(EDIT_KEY, !editMode); location.reload(); });
  const off = new URL(location.href);
  off.searchParams.set("admin", "off");
  bar.append(toggle, " · ", link(off.href, "Leave admin mode"));
  footer.append(bar);
}
