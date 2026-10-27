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
