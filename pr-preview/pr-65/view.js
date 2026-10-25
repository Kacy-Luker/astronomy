// One page full size, in the view it was opened from (Inverted, Cleaned or
// Original), so tapping a page doesn't lose the inversion: that's a style on
// the site, not part of the image file.
import { el, link } from "./lib.js";

const main = document.getElementById("view");
const params = new URLSearchParams(location.search);
const src = params.get("img") ?? "";
const view = params.get("view");
const name = params.get("name");

// Only the site's own page images, so the link can't show anything else.
if (/^(scans|sketches)\/[a-z0-9-]+\/[\w.-]+\.jpg$/.test(src)) {
  if (name) document.title = `${name} · Observing Log`;
  const figure = el("figure", "page");
  const img = el("img");
  img.src = src;
  img.alt = name ?? "Notebook page";
  figure.append(img);
  if (name) figure.append(el("figcaption", "page-name", name));
  main.classList.toggle("inverted", view === "inverted");
  main.replaceChildren(figure, el("p", "muted"));
  main.lastChild.append(link(src, "Open the image file"));
} else {
  main.replaceChildren(el("p", "summary", "There's no page to show here."));
}

// Back to the page this was opened from, keeping its scroll position.
document.getElementById("back").addEventListener("click", (e) => {
  if (history.length > 1) {
    e.preventDefault();
    history.back();
  }
});
