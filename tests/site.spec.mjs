// Site tests (#89) against the test site's build: the made-up test data in
// test-data/, at phone and desktop width (playwright.config.mjs). Expected
// values come from the test data itself where they can, so editing it
// doesn't break the tests for no reason.
import { readFileSync, readdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { todoCount } from "../site/todos.js";
import { observationMoon } from "../scripts/lib/moon.mjs";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const sessions = readdirSync("test-data/sessions").map((f) => read(`test-data/sessions/${f}`));
const notebooks = readdirSync("test-data/notebooks").map((f) => read(`test-data/notebooks/${f}`));
const session = (id) => sessions.find((s) => s.id === id);
const observations = sessions.flatMap((s) => s.observations);

// Every page fails on a script error, a console error or a failed request
// (map tiles are an outside service, so they're blocked, not fetched).
const problemsOf = new WeakMap();
test.beforeEach(async ({ page }) => {
  const problems = [];
  problemsOf.set(page, problems);
  page.on("pageerror", (e) => problems.push(`error: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/ERR_FAILED/.test(m.text())) problems.push(`console: ${m.text()}`); });
  page.on("requestfailed", (r) => { if (!r.url().includes("tile.openstreetmap.org")) problems.push(`failed: ${r.url()}`); });
  await page.route(/tile\.openstreetmap\.org/, (route) => route.abort());
});
test.afterEach(async ({ page }) => {
  expect(problemsOf.get(page), "script errors, console errors or failed requests").toEqual([]);
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(sideways, "the page scrolls sideways").toBe(false);
});

const PAGES = [
  "", "#sessions", "#sketches", "#sketches/ngc", "#equipment", "#map", "#activity", "help.html",
  ...notebooks.map((n) => `notebook.html?id=${n.id}`),
  ...sessions.map((s) => `session.html?id=${s.id}`),
  ...["M31", "NGC 224", "C14", "Albireo"].map((id) => `object.html?id=${encodeURIComponent(id)}`),
  "view.html?img=test-data/scans/test-001/06.jpg&view=inverted",
];
for (const path of PAGES) {
  test(`loads ${path || "home"}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator(".preview-banner")).toContainText("Test site");
    await expect(page.locator("body")).not.toContainText(/Couldn't load|There's no page to show/);
    await expect(page.locator("main")).not.toBeEmpty();
  });
}

test("the test site shows the test data, and the admin bar's Test data toggle switches it (#117, #133)", async ({ page }) => {
  const count = `${sessions.length} sessions · ${observations.length} observations`;
  const summary = page.locator(".summary").first();
  // Loaded (not the "Loading" text) and showing the real data, not the test data's count.
  const real = async () => {
    await expect(summary).toContainText("observations");
    await expect(summary).not.toContainText(count);
  };
  await page.goto("");
  await expect(summary).toContainText(count);
  // Only in admin mode, as a button like Edit links.
  const toggle = page.locator(".admin-bar").getByRole("button", { name: /^Test data:/ });
  await expect(toggle).toHaveCount(0);
  await page.goto("?admin=on");
  await expect(toggle).toHaveText("Test data: on");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  // Off from the test site goes to the live site's page (dataSwitch(), unit-tested);
  // here, showing the real data on the test site, on switches in place.
  await page.goto("?data=real");
  await real();
  await expect(toggle).toHaveText("Test data: off");
  // Remembered on the next visit.
  await page.goto("#sessions");
  await real();
  await toggle.click();
  await expect(page).toHaveURL(/data=test/);
  await expect(summary).toContainText(count);
  await expect(toggle).toHaveText("Test data: on");
});

test("to-dos, N/A and the Clear Sky Chart words", async ({ page }) => {
  const s = session("2025-06-21-backyard");
  await page.goto(`session.html?id=${s.id}`);
  await expect(page.locator(".tag.todo").first()).toHaveText(`${todoCount(s)} to do`);
  // Saturn has blank fields; Albireo has N/A for the filter.
  const facts = (name) => page.locator("article.observation").filter({ has: page.locator("h3", { hasText: new RegExp(`^${name}$`) }) }).locator("dl.facts");
  await expect(facts("Saturn")).toContainText("To do");
  await expect(facts("Albireo")).toContainText("N/A");
  // Seeing I is Excellent; transparency I is Poor.
  await expect(facts("NGC 224")).toContainText("Excellent");
  await expect(facts("NGC 224")).toContainText("Poor");
  await page.goto("session.html?id=2025-10-18-okie-tex-2025");
  await expect(page.locator("main")).toContainText("Transparent");
  await expect(page.locator("main")).toContainText("Bad");
});

test("an object under two designations is one object, with its catalog line and favorite", async ({ page }) => {
  const seen = observations.filter((o) => (o.ids ?? []).includes("M31")).length;
  for (const id of ["M31", "NGC 224"]) {
    await page.goto(`object.html?id=${encodeURIComponent(id)}`);
    await expect(page.locator("main")).toContainText(`${seen} times`);
    await expect(page.locator("main")).toContainText("Galaxy");
    await expect(page.locator("main")).toContainText("Andromeda");
    // The favorite's sketch is shown first.
    await expect(page.locator("main")).toContainText("Favorite");
  }
});

test("the Sketches tab's catalog toggle is in the address, and back returns to the last tab", async ({ page }) => {
  await page.goto("#sessions");
  await page.getByRole("tab", { name: "Sketches" }).click();
  await page.getByRole("button", { name: /^NGC/ }).click();
  await expect(page).toHaveURL(/#sketches\/ngc$/);
  await page.reload();
  await expect(page.getByRole("button", { name: /^NGC/ })).toHaveAttribute("aria-pressed", "true");
  await page.goBack();
  await expect(page).toHaveURL(/#sessions$/);
});

test("the scan view toggle is remembered", async ({ page }) => {
  await page.goto("notebook.html?id=test-001");
  await page.getByRole("button", { name: "Original" }).first().click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Original" }).first()).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Inverted" }).first().click();
});

test("Inverted is a plain inversion (the blue look), also full size (#96)", async ({ page }) => {
  await page.goto("notebook.html?id=test-001");
  await page.getByRole("button", { name: "Inverted" }).first().click();
  await expect(page.locator(".scans img").first()).toHaveCSS("filter", "invert(1)");
  await expect(page.getByRole("button", { name: "Blue" })).toHaveCount(0);
  // A link from when Blue was its own view still shows it.
  await page.goto("view.html?img=test-data/scans/test-001/06.jpg&view=blue");
  await expect(page.locator("figure.page img")).toHaveCSS("filter", "invert(1)");
});

test("search and filters narrow the observations", async ({ page }) => {
  const m31 = observations.filter((o) => (o.ids ?? []).includes("M31")).length;
  await page.goto("?q=andromeda");
  await expect(page.locator(".summary").first()).toContainText(`${m31} matching observation`);
  await page.goto("?fav=1");
  await expect(page.locator(".summary").first()).toContainText("1 matching observation");
  await expect(page.locator(".chip").first()).toContainText("Favorites only");
});

test("the Activity tab counts the test data, and narrows with the search (#128)", async ({ page }) => {
  // The build's copy has each observation's catalog object, so M31 and
  // NGC 224 count as one.
  const built = read("dist/test-data/data/sessions.json").flatMap((s) => s.observations.map((o) => ({ s, o })));
  const objectsOf = (docs) => new Set(docs.map(({ o }) => o.catalog?.key ?? o.catalog_id)).size;
  const sessionsOf = (docs) => new Set(docs.map(({ s }) => s.id)).size;
  const total = (name) => page.locator(`#activity [data-total="${name}"] dd`);

  await page.goto("#activity");
  await expect(page.locator("#tab-activity")).toHaveAttribute("aria-selected", "true");
  await expect(total("sessions")).toHaveText(String(sessions.length));
  await expect(total("observations")).toHaveText(String(observations.length));
  await expect(total("objects")).toHaveText(String(objectsOf(built)));
  await expect(page.locator("#activity")).toContainText("I · Excellent");
  await expect(page.locator("#activity")).toContainText("V · Transparent");

  const m31 = built.filter(({ o }) => (o.ids ?? []).includes("M31"));
  await page.goto("?q=andromeda#activity");
  await expect(total("observations")).toHaveText(String(m31.length));
  await expect(total("sessions")).toHaveText(String(sessionsOf(m31)));
  await expect(total("objects")).toHaveText("1");
});

test("the Activity tab's observing programs count the test data, and follow the search (#125)", async ({ page }) => {
  // Every designation observed, as site/programs.js gathers them.
  const catalog = read("test-data/objects.json").objects;
  const built = read("dist/test-data/data/sessions.json").flatMap((s) => s.observations);
  const seen = new Set(built.flatMap((o) => [...(catalog[o.catalog?.key ?? o.catalog_id]?.ids ?? []), ...(o.ids ?? []), o.catalog_id]));
  const done = (prefix, size) => Array.from({ length: size }, (_, i) => `${prefix}${i + 1}`).filter((id) => seen.has(id));
  const messier = done("M", 110);
  const caldwell = done("C", 109);
  expect(messier.length, "the test data has a partly done Messier program").toBeGreaterThan(0);
  expect(caldwell.length, "the test data has a partly done Caldwell program").toBeGreaterThan(0);

  const program = (name) => page.locator(`#activity [data-program="${name}"]`);
  await page.goto("#activity");
  await expect(program("messier").locator(".program-count")).toHaveText(`${messier.length} of 110`);
  await expect(program("caldwell").locator(".program-count")).toHaveText(`${caldwell.length} of 109`);
  await expect(page.locator("#activity")).not.toContainText("current selection");
  await program("messier").locator("summary").click();
  await expect(program("messier").locator(".seen")).toHaveCount(messier.length);
  await expect(program("messier").locator(".not-yet")).toHaveCount(110 - messier.length);
  await expect(program("messier").getByRole("link", { name: "✓ M31", exact: true })).toHaveAttribute("href", /object\.html\?id=M31/);
  const missing = Array.from({ length: 110 }, (_, i) => `M${i + 1}`).find((id) => !seen.has(id));
  await expect(program("messier").locator(".not-yet", { hasText: new RegExp(`^${missing}$`) })).toBeVisible();

  await page.goto("?q=andromeda#activity");
  await expect(program("messier").locator(".program-count")).toHaveText("1 of 110");
  await expect(program("caldwell").locator(".program-count")).toHaveText("0 of 109");
  await expect(page.locator("#activity .programs")).toContainText("Observed in the current selection.");
});

test("the map groups sites by spot, and its Near link lists every session there", async ({ page }) => {
  const atSpot = sessions.filter((s) => Math.round(s.site.lat * 10) === 369 && Math.round(s.site.lon * 10) === -1030);
  await page.goto("#map");
  // Zoomed out to fit both hemispheres, nearby markers overlap, so the
  // marker is clicked directly rather than at its spot on screen.
  await page.locator(".map-marker", { hasText: String(atSpot.reduce((n, s) => n + s.observations.length, 0)) }).dispatchEvent("click");
  const popup = page.locator(".map-popup");
  await expect(popup).toContainText(`${atSpot.length} sessions`);
  // Site names without their years.
  await expect(popup.locator("strong")).toHaveText("Okie-Tex · Camp Billy Joe + 1 more");
  // Followed by its address: a click can miss while the map is still
  // panning to fit the popup.
  await page.goto(await popup.getByRole("link", { name: /here$/ }).getAttribute("href"));
  await expect(page.locator(".chip").first()).toContainText("Near: Okie-Tex");
  await expect(page.locator(".summary").first()).toContainText(`${atSpot.length} sessions`);
  // The session without coordinates is listed under the map.
  await page.goto("#map");
  await expect(page.locator(".map-note").last()).toContainText("Library star party");
});

test("the map opens on the USA, and fits other sites when only they match", async ({ page }) => {
  const away = new Set(sessions.filter((s) => s.site.lat != null && (s.site.lat < 24 || s.site.lon > -66)).map((s) => s.site.name));
  await page.goto("#map");
  await expect(page.locator(".map-note").first()).toContainText(`Zoom out for ${away.size} site${away.size === 1 ? "" : "s"} outside the USA`);
  // Okie-Tex is in view, Siding Spring isn't.
  const inView = (text) => page.locator(".map-marker", { hasText: text }).evaluate((m) => {
    const r = m.getBoundingClientRect(), f = m.closest(".map-frame").getBoundingClientRect();
    return r.right > f.left && r.left < f.right && r.bottom > f.top && r.top < f.bottom;
  });
  const okieTex = String(sessions.filter((s) => Math.round(s.site.lat * 10) === 369).reduce((n, s) => n + s.observations.length, 0));
  const sidingSpring = String(session("2026-10-24-siding-spring").observations.length);
  expect(await inView(okieTex)).toBe(true);
  expect(await inView(sidingSpring)).toBe(false);
  // With only the Australia session matching, the map fits it.
  await page.goto("?site=Siding%20Spring#map");
  await expect(page.locator(".map-note").first()).not.toContainText("outside the USA");
  expect(await inView(sidingSpring)).toBe(true);
});

test("admin mode can be turned back on from the footer, only where it's been used (#112)", async ({ page }) => {
  const footerLink = page.locator(".site-footer").getByRole("button", { name: "Admin mode: off" });
  await page.goto("");
  await expect(page.locator(".summary").first()).toContainText("observations");
  await expect(footerLink).toHaveCount(0);
  await page.goto("?admin=on");
  await expect(page.locator(".admin-bar")).toBeVisible();
  await page.locator(".admin-bar").getByRole("button", { name: "Admin mode: on" }).click();
  await expect(page.locator(".admin-bar")).toHaveCount(0);
  // As in the installed app: no address bar, so back on from the footer.
  await footerLink.click();
  await expect(page.locator(".admin-bar")).toBeVisible();
});

test("Sketches thumbnails are always inverted, cover thumbnails never (#122)", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("page-view", "original"));
  await page.goto("#sketches");
  const thumb = page.locator(".sketch-thumb img").first();
  await expect(thumb).toHaveCSS("filter", "invert(1)");
  await expect(thumb).toHaveAttribute("src", /\.thumb\.clean\.jpg$/);
  await page.evaluate(() => localStorage.setItem("page-view", "inverted"));
  await page.goto("#notebooks");
  await expect(page.locator(".cover-thumb").first()).toHaveCSS("filter", "none");
});

test("each observation card has the Moon's phase, and tapping it says how much was lit (#127)", async ({ page }) => {
  const s = session("2026-08-15-davis-mountains");
  const moon = observationMoon(s, s.observations[0]);
  await page.goto(`session.html?id=${s.id}`);
  const card = page.locator("article.observation").first();
  const button = card.locator("button.moon");
  await expect(button).toHaveAttribute("aria-label", `Moon: ${moon.name}, ${moon.illumination}% lit${moon.up === false ? ", below the horizon" : ""}`);
  // Below the horizon the glyph is greyed with a dashed outline.
  await expect(button.locator("svg.moon-glyph")).toHaveClass(moon.up === false ? /\bdown\b/ : /^moon-glyph$/);
  await expect(page.locator("article.observation button.moon")).toHaveCount(s.observations.length);
  const note = card.locator(".moon-note");
  await expect(note).toBeHidden();
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(note).toBeVisible();
  await expect(note).toContainText(`${moon.illumination}% illuminated`);
  await expect(note).toContainText(moon.up ? "The Moon was up" : "below the horizon");
  // Keyboard: the button is reachable and closes the note again.
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(note).toBeHidden();
  // An entry with no time gets the evening's phase, and nothing about up.
  const untimed = session("2025-06-21-backyard");
  const i = untimed.observations.findIndex((o) => o.local_time == null);
  await page.goto(`session.html?id=${untimed.id}`);
  const other = page.locator("article.observation").nth(i);
  await other.locator("button.moon").click();
  await expect(other.locator(".moon-note")).toContainText("No time written");
  await expect(other.locator(".moon-note")).not.toContainText("horizon");
  // South of the equator: mirrored, with a kangaroo on the icon.
  await expect(button.locator(".moon-south")).toHaveCount(0);
  await page.goto("session.html?id=2026-10-24-siding-spring");
  const south = page.locator("article.observation button.moon").first();
  await expect(south.locator(".moon-south")).toHaveCount(1);
  await expect(south).toHaveAttribute("aria-label", /seen from the southern hemisphere$/);
  // The object page's observations have it too.
  await page.goto(`object.html?id=${encodeURIComponent("M31")}`);
  await expect(page.locator("article.observation button.moon").first()).toBeVisible();
});
