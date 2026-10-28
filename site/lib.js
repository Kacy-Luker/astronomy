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

// The test site and PR previews (#64) can show the made-up test data
// (test-data/) instead of the real log. Their banner carries
// data-test-data, the dataset shown by default; ?data=test or ?data=real
// switches, and this browser remembers the choice. The live site has no
// test data and always shows the real log. The switch is in the admin bar
// (#117, #133; dataSwitch() below).
const DATA_KEY = "observing-log-data";
const testBanner = document.querySelector(".preview-banner[data-test-data]");
function chooseData() {
  if (!testBanner) return "real";
  const asked = new URLSearchParams(location.search).get("data");
  if (asked === "test" || asked === "real") {
    try { localStorage.setItem(DATA_KEY, asked); } catch { /* not remembered */ }
    return asked;
  }
  let saved = null;
  try { saved = localStorage.getItem(DATA_KEY); } catch { /* none */ }
  return saved === "test" || saved === "real" ? saved : testBanner.dataset.testData;
}
export const dataset = chooseData();
const DATA_ROOT = dataset === "test" ? "test-data/" : "";
// A data file's path in the repo, e.g. dataFile("notebooks/x.json").
export const dataFile = (path) => `${dataset === "test" ? "test-data" : "data"}/${path}`;

// The admin bar's Test data toggle (#133): where it goes from this page.
// Turning test data off from the test site (testSite) goes back to the
// same page on the live site; turning it on from the live site, which has
// only the real data, opens the same page on the test site (test/). A
// preview has both, and switches in place.
export function dataSwitch(href, { both, testSite, current }) {
  const on = current === "test";
  const url = new URL(href);
  if (on && testSite) {
    url.pathname = url.pathname.replace(/test\/([^/]*)$/, "$1");
    url.searchParams.delete("data");
  } else if (both) url.searchParams.set("data", on ? "real" : "test");
  else {
    url.pathname = url.pathname.replace(/[^/]*$/, (page) => `test/${page}`);
    url.searchParams.set("data", "test");
  }
  return { on, href: url.href };
}

export const loadSessions = () => loadJSON(`${DATA_ROOT}data/sessions.json`);
export const loadNotebooks = () => loadJSON(`${DATA_ROOT}data/notebooks.json`);
// Catalog info by object (data/objects.json); empty when there is none.
export const loadObjects = () => loadJSON(`${DATA_ROOT}data/objects.json`).then((d) => d.objects, () => ({}));

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

// How scans are shown: inverted (the default; a plain inversion, so the
// cream paper turns navy and pencil pale blue, #96), cleaned (stamp
// show-through removed), or the original scan. Inverted uses the cleaned
// image. The viewer's last choice is remembered; storage can be unavailable.
const VIEWS = { inverted: "Inverted", cleaned: "Cleaned", original: "Original" };
// Inverted is .inverted (style.css). "blue" was briefly its own view, so
// links and saved choices naming it get the same look.
export function viewClasses(target, view) {
  target.classList.toggle("inverted", view === "inverted" || view === "blue");
}
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
  viewClasses(target, view);
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
// (?admin=off turns it off), which this browser remembers (previews share
// the setting, being on the same site). It adds an admin bar at the top
// of the page with the how-to page (help.html), toggles for the Edit links
// (which open a data file in GitHub's web editor) and the test data, and
// an "Admin mode: on" toggle that turns it off. The installed app has no
// address bar, so a device that has been in admin mode also gets an
// "Admin mode: off" toggle in the footer to turn it back on (#112);
// visitors never see it.
const REPO = "https://github.com/Kacy-Luker/astronomy";
const ADMIN_KEY = "observing-log-admin";
const EDIT_KEY = "observing-log-edit";
const ADMIN_SEEN_KEY = "observing-log-admin-seen";
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
export const adminMode = adminParam !== "off" && (adminParam === "on" || stored(ADMIN_KEY));
if (adminMode) store(ADMIN_SEEN_KEY, true);
// On a PR preview the Edit links open the PR branch's files, not main's.
const branch = document.querySelector(".preview-banner")?.dataset.branch ?? "main";
export const editMode = adminMode && stored(EDIT_KEY);

// A link to edit a file in the repo (e.g. data/sessions/<id>.json), or null
// when the Edit links are off.
export const sessionFile = (id) => dataFile(`sessions/${id}.json`);
export function editLink(path, text = "Edit") {
  if (!editMode) return null;
  const a = link(`${REPO}/edit/${branch}/${path}`, text, "edit-link");
  a.title = `Edit ${path} on GitHub`;
  return a;
}

// The admin star for setting Kacy's favorite observation of an object
// (#23), or null outside admin mode. The site can't save a tap, so it opens
// a ready-made GitHub issue; submitting it runs .github/workflows/
// favorite.yml, which opens a pull request. n counts the observation from 1
// in its session's file.
export function favoriteLink(o, s, n) {
  // The Favorite workflow only changes the real data.
  if (!adminMode || dataset === "test") return null;
  const verb = o.favorite ? "Unfavorite" : "Favorite";
  const what = `${o.catalog_id} on ${formatDate(s.date)}`;
  const body = [
    o.favorite
      ? `Tap Submit to stop this being your favorite observation of ${o.catalog_id}. A pull request will follow.`
      : `Tap Submit to make this your favorite observation of ${o.catalog_id}, replacing any other. A pull request will follow.`,
    "",
    `Session: ${s.id}`,
    `Observation: ${n}`,
  ].join("\n");
  const a = link(`${REPO}/issues/new?${new URLSearchParams({ title: `${verb}: ${what}`, body })}`, o.favorite ? "★" : "☆", "favorite-link");
  a.title = o.favorite ? `Stop ${what} being the favorite` : `Make ${what} the favorite`;
  a.setAttribute("aria-label", a.title);
  return a;
}

// The admin bar's buttons, all drawn alike.
function adminButton(text, onClick, className = "admin-toggle") {
  const button = el("button", className, text);
  button.type = "button";
  button.addEventListener("click", onClick);
  return button;
}
// This page with ?admin=on or off.
function withAdmin(value) {
  const url = new URL(location.href);
  url.searchParams.set("admin", value);
  return url.href;
}

// The admin bar runs across the top of the page, under the preview banner
// on a PR preview, and scrolls away with the page.
if (adminMode) {
  const bar = el("div", "admin-bar");
  bar.append(el("strong", null, "Admin"), " · ");
  // The Edit links are drawn as the page loads, so switching reloads it.
  const edit = adminButton(`Edit links: ${editMode ? "on" : "off"}`, () => { store(EDIT_KEY, !editMode); location.reload(); });
  edit.setAttribute("aria-pressed", String(editMode));
  const { on, href } = dataSwitch(location.href, {
    both: Boolean(testBanner), testSite: Boolean(document.querySelector(".preview-banner[data-test-site]")), current: dataset,
  });
  const data = adminButton(`Test data: ${on ? "on" : "off"}`, () => location.assign(href));
  data.classList.add("data-toggle");
  data.setAttribute("aria-pressed", String(on));
  const leave = adminButton("Admin mode: on", () => location.assign(withAdmin("off")));
  leave.setAttribute("aria-pressed", "true");
  bar.append(link("help.html", "How to add a session"), " · ", edit, " · ", data, " · ", leave);
  const banner = document.querySelector(".preview-banner");
  if (banner) banner.after(bar);
  else document.body.prepend(bar);
}

// Back into admin mode, on a device that has used it (#112).
if (!adminMode && stored(ADMIN_SEEN_KEY)) {
  const footer = document.querySelector(".site-footer") ?? document.body.appendChild(el("footer", "site-footer muted"));
  const on = adminButton("Admin mode: off", () => location.assign(withAdmin("on")), "admin-toggle admin-on");
  on.setAttribute("aria-pressed", "false");
  footer.append(" ", on);
}
