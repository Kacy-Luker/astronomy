// Page categories, from data/categories.json: the order they appear in a
// notebook and on the site, and how each is treated. Claude puts each page
// in one; a page's place in the notebook follows its category, and session
// pages follow their page numbers.
import { readFileSync } from "node:fs";

export const CATEGORIES = JSON.parse(readFileSync(new URL("../../data/categories.json", import.meta.url), "utf8")).categories;
export const category = (kind) => CATEGORIES.find((c) => c.kind === kind);

// Kinds a scanned page can have: every category but the front cover (which
// is scanned on its own), plus unused session pages and blank pages.
export const PAGE_KINDS = [...CATEGORIES.map((c) => c.kind).filter((k) => k !== "front_cover"), "unused", "blank"];

const SESSION = CATEGORIES.findIndex((c) => c.kind === "session");

// Where each page's category comes in the order. Unused pages and numbered
// blank pages are session pages; an unnumbered blank page goes with the page
// after it (or before it, at the end), like the blank facing the title page
// or the first index page.
export function ranks(pages) {
  const own = pages.map((p) => (p.kind === "unused" || (p.kind === "blank" && p.number != null) ? SESSION
    : p.kind === "blank" ? null : CATEGORIES.findIndex((c) => c.kind === p.kind)));
  const out = [...own];
  for (let i = out.length - 2; i >= 0; i--) out[i] ??= out[i + 1];
  for (let i = 1; i < out.length; i++) out[i] ??= out[i - 1];
  return out.map((r) => r ?? SESSION);
}

export const isBack = (rank) => rank > SESSION;
export const SESSION_RANK = SESSION;

// Problems with a notebook's page order: unknown kinds, categories out of
// order, a single category twice, and session pages out of number order.
export function orderErrors(pages) {
  const errors = [];
  pages.forEach((p, i) => {
    if (!PAGE_KINDS.includes(p.kind)) errors.push(`/pages/${i}/kind "${p.kind}" isn't a category in data/categories.json`);
  });
  if (errors.length) return errors;
  const r = ranks(pages);
  const name = (i) => `/pages/${i} (${pages[i].number != null ? `page ${pages[i].number}` : category(pages[i].kind)?.label ?? pages[i].kind})`;
  for (let i = 1; i < pages.length; i++) {
    if (r[i] < r[i - 1]) errors.push(`${name(i)} comes after ${category(pages[i - 1].kind)?.label ?? pages[i - 1].kind}, out of category order`);
  }
  for (const c of CATEGORIES.filter((c) => c.single)) {
    const at = pages.flatMap((p, i) => (p.kind === c.kind ? [i] : []));
    if (at.length > 1) errors.push(`/pages has ${at.length} ${c.label} pages (${at.join(", ")}); there can only be one`);
  }
  let last = 0;
  pages.forEach((p, i) => {
    if (p.number == null) return;
    if (p.number <= last) errors.push(`${name(i)} comes after page ${last}`);
    last = p.number;
  });
  return errors;
}
