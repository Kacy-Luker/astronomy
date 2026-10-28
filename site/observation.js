// Pieces of an observation shared by the session and object pages: the
// log sheet's fields and the description.
import { el, link, notebookHref, pageName, seeingText, transparencyText } from "./lib.js";
import { isBlank, isNA } from "./todos.js";

// Append a <dt>/<dd> pair, skipping empty values. value may be a node.
export function field(dl, label, value) {
  if (value == null || value === "") return;
  const dd = el("dd");
  dd.append(value instanceof Node ? value : String(value));
  dl.append(el("dt", null, label), dd);
}

// A field from the log sheet: N/A shows muted, and a blank field (one to
// come back to) shows a To do marker. display formats a filled-in value.
export function sheetField(dl, label, value, display = value) {
  const dd = el("dd");
  if (isNA(value)) dd.append(el("span", "muted", "N/A"));
  else if (isBlank(value)) dd.append(el("span", "todo", "To do"));
  else dd.append(display instanceof Node ? display : String(display));
  dl.append(el("dt", null, label), dd);
}

export function scopeText(scope) {
  if (!scope) return null;
  const specs = [
    scope.type,
    scope.aperture_mm && `${scope.aperture_mm} mm`,
    scope.focal_length_mm && `${scope.focal_length_mm} mm FL`,
    scope.f_ratio && `f/${scope.f_ratio}`,
  ].filter(Boolean);
  return specs.length ? `${scope.name} (${specs.join(", ")})` : scope.name;
}

export const pageOf = (notebook, number) => notebook?.pages.find((p) => p.number === number);

// The entry's fields, as on the sheet, with a link to its notebook page.
export function observationFacts(o, notebook) {
  const dl = el("dl", "facts");
  sheetField(dl, "Local time", o.local_time);
  sheetField(dl, "UT", o.ut);
  sheetField(dl, "Seeing", o.seeing, seeingText(o.seeing));
  sheetField(dl, "Transparency", o.transparency, transparencyText(o.transparency));
  if (o.scope) field(dl, "Scope", scopeText(o.scope));
  sheetField(dl, "Eyepiece", o.eyepiece);
  sheetField(dl, "Magnification", o.magnification, `${o.magnification}×`);
  sheetField(dl, "Filter", o.filter);
  const page = pageOf(notebook, o.page);
  if (page) field(dl, "Notebook", link(notebookHref(notebook.id, page), pageName(page)));
  return dl;
}

export function observationDescription(o) {
  if (isBlank(o.description)) return el("p", "description todo", "Description: to do");
  if (isNA(o.description)) return el("p", "description muted", "Description: N/A");
  return el("p", "description", o.description);
}

// The Moon's phase as a small glyph (#127): the lit part of the disc, lit
// on the right while waxing as seen from the north, mirrored south of the
// equator. phase runs 0 to 1 (0 new, 0.5 full); lit is the lit fraction.
// The disc is outlined, so a new Moon is a whole dark circle; down (the
// Moon below the horizon) greys the phase and dashes the outline.
const SVG = "http://www.w3.org/2000/svg";
export function moonGlyph(phase, lit, south = false, down = false) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "-10 -10 20 20");
  svg.setAttribute("class", down ? "moon-glyph down" : "moon-glyph");
  svg.setAttribute("aria-hidden", "true");
  const disc = document.createElementNS(SVG, "circle");
  disc.setAttribute("r", "9");
  disc.setAttribute("class", "moon-dark");
  svg.append(disc);
  if (lit > 0.005) {
    // The limb on the lit side, then the terminator (half an ellipse) back.
    const waxing = phase < 0.5;
    const rx = (9 * Math.abs(1 - 2 * lit)).toFixed(2);
    const term = waxing === lit < 0.5 ? 0 : 1;
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", `M0 -9A9 9 0 0 ${waxing ? 1 : 0} 0 9A${rx} 9 0 0 ${term} 0 -9Z`);
    path.setAttribute("class", "moon-lit");
    if (south) path.setAttribute("transform", "scale(-1 1)");
    svg.append(path);
  }
  return svg;
}

// The Moon at an observation (o.moon, worked out by the build): a button
// with the glyph for the card's heading row, and the note it opens with
// the phase name, how much was lit and, with the site's coordinates and a
// time, whether the Moon was up. Nothing when the build had no date.
let moonNotes = 0;
export function moonParts(o, s) {
  const m = o.moon;
  if (!m) return { button: null, note: null };
  const summary = `${m.name}, ${m.illumination}% lit${m.up === false ? ", below the horizon" : ""}`;
  const button = el("button", "tag moon");
  button.type = "button";
  button.title = `Moon: ${summary}`;
  button.setAttribute("aria-label", `Moon: ${summary}`);
  button.setAttribute("aria-expanded", "false");
  // A New Moon is drawn dark, without the sliver of its last few percent.
  const lit = m.name === "New Moon" ? 0 : m.illumination / 100;
  button.append(moonGlyph(m.phase, lit, s.site?.lat < 0, m.up === false));
  const note = el("p", "moon-note");
  note.id = `moon-note-${++moonNotes}`;
  note.hidden = true;
  const parts = [`${m.name}, ${m.illumination}% illuminated.`];
  if (m.up === true) parts.push(`The Moon was up, ${Math.max(0, m.altitude)}° above the horizon.`);
  else if (m.up === false) parts.push("The Moon was below the horizon.");
  parts.push(m.timed ? "Times are approximate." : "No time written, so for the evening.");
  note.textContent = parts.join(" ");
  button.setAttribute("aria-controls", note.id);
  button.addEventListener("click", () => {
    note.hidden = !note.hidden;
    button.setAttribute("aria-expanded", String(!note.hidden));
  });
  return { button, note };
}
