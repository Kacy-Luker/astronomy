// The search and filter bar, the same on every page (#26): a search box, a
// Filters button opening a dropdown for each filter (site/search.js), a
// date range and "Has to-dos", and the active filters as chips with an ×
// and Clear all. Changes go into the URL and to onChange(state).
//
// docs are what the page shows (all observations on the home page, one
// session's on its page, ...), and the dropdowns offer only their values,
// hiding a filter with a single choice. When the page lists fewer than two
// things (count: observations, or sessions on a notebook page), there's
// nothing to narrow: the bar is hidden and the page gets an empty state,
// while the URL keeps the filters for the pages after it.
import { CATALOGS } from "./catalog.js";
import { el } from "./lib.js";
import { FILTERS, activeFilters, hasTodo, keepFilters, nameKey, readFilters, writeFilters } from "./search.js";

const CATALOG_ORDER = [...CATALOGS.map((c) => c.name), "Other"];

// The distinct names, merging spellings (nameKey), each in the spelling
// written most often.
export function mostUsed(names) {
  const counts = new Map();
  for (const n of names) {
    const k = nameKey(n);
    if (!counts.has(k)) counts.set(k, new Map());
    counts.get(k).set(n, (counts.get(k).get(n) ?? 0) + 1);
  }
  return [...counts.values()].map((spellings) => [...spellings].sort((a, b) => b[1] - a[1])[0][0]);
}

export function filterBar(docs, onChange, { placeholder = "Search", count = docs.length } = {}) {
  let state = readFilters();
  const bar = el("div", "search");
  if (count < 2) {
    bar.hidden = true;
    const none = Object.fromEntries(Object.keys(state).map((k) => [k, ""]));
    return { element: bar, state: () => none };
  }

  const row = el("div", "search-row");
  const input = el("input");
  input.type = "search";
  input.placeholder = placeholder;
  input.setAttribute("aria-label", "Search observations");
  input.value = state.q;
  const toggle = el("button", "filters-button");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "false");
  row.append(input, toggle);

  const panel = el("div", "filters-panel");
  panel.hidden = true;
  panel.id = "filters-panel";
  toggle.setAttribute("aria-controls", panel.id);
  const chips = el("div", "chips");
  bar.append(row, panel, chips);

  const labelled = (text, control) => {
    const label = el("label", "filter");
    label.append(el("span", "muted", text), control);
    return label;
  };
  const controls = {};
  // One option per name however it's written, in its most used spelling.
  const choices = (key) => mostUsed(docs.flatMap((d) => d.values[key]));
  for (const f of FILTERS) {
    const values = choices(f.key)
      .sort((a, b) => (f.key === "catalog" ? CATALOG_ORDER.indexOf(a) - CATALOG_ORDER.indexOf(b) : a.localeCompare(b)));
    // A filter with only one choice wouldn't narrow anything, and one with
    // as many as the filter it groups would repeat it.
    if (values.length < 2 && !state[f.key]) continue;
    if (f.sameAs && values.length === choices(f.sameAs).length && !state[f.key]) continue;
    const select = el("select");
    select.append(new Option("Any", ""), ...values.map((v) => new Option(v, v)));
    controls[f.key] = select;
    panel.append(labelled(f.label, select));
  }
  // A date range only with more than one night, and Has to-dos only when
  // some observations have them and some don't.
  const dates = new Set(docs.map((d) => d.s.date));
  for (const [key, text] of [["from", "From"], ["to", "To"]]) {
    if (dates.size < 2 && !state.from && !state.to) continue;
    const date = el("input");
    date.type = "date";
    controls[key] = date;
    panel.append(labelled(text, date));
  }
  const todos = new Set(docs.map((d) => hasTodo(d.o, d.s)));
  if (todos.size > 1 || state.todo) {
    const todo = el("input");
    todo.type = "checkbox";
    controls.todo = todo;
    const todoLabel = el("label", "filter check");
    todoLabel.append(todo, " Has to-dos");
    panel.append(todoLabel);
  }

  const LABELS = Object.fromEntries([...FILTERS.map((f) => [f.key, f.label]), ["from", "From"], ["to", "To"], ["todo", "Has to-dos"]]);
  function update(next) {
    state = next;
    writeFilters(state);
    sync();
    onChange(state);
    keepFilters();
  }
  // The controls, button and chips as the state says.
  function sync() {
    for (const [key, control] of Object.entries(controls)) {
      if (control.type === "checkbox") control.checked = Boolean(state[key]);
      else control.value = state[key] ?? "";
    }
    const active = activeFilters(state);
    toggle.textContent = active.length ? `Filters · ${active.length}` : "Filters";
    chips.replaceChildren(...active.map((key) => {
      const chip = el("button", "chip");
      chip.type = "button";
      chip.textContent = key === "todo" ? `${LABELS[key]} ×` : `${LABELS[key]}: ${state[key]} ×`;
      chip.setAttribute("aria-label", `Remove filter ${LABELS[key]}`);
      chip.addEventListener("click", () => update({ ...state, [key]: "" }));
      return chip;
    }));
    if (active.length || state.q) {
      const clear = el("button", "chip clear", "Clear all");
      clear.type = "button";
      clear.addEventListener("click", () => {
        input.value = "";
        update(Object.fromEntries(Object.keys(state).map((k) => [k, ""])));
      });
      chips.append(clear);
    }
  }
  input.addEventListener("input", () => update({ ...state, q: input.value }));
  for (const [key, control] of Object.entries(controls)) {
    control.addEventListener("change", () => update({ ...state, [key]: control.type === "checkbox" ? (control.checked ? "1" : "") : control.value }));
  }
  toggle.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-expanded", String(!panel.hidden));
  });
  sync();
  return { element: bar, state: () => state };
}
