// The search and filter bar, the same on every page (#26): a search box, a
// Filters button opening a dropdown for each filter (site/search.js), a
// date range and "Has to-dos", and the active filters as chips with an ×
// and Clear all. Changes go into the URL and to onChange(state).
import { CATALOGS } from "./catalog.js";
import { el } from "./lib.js";
import { FILTERS, activeFilters, keepFilters, readFilters, writeFilters } from "./search.js";

const CATALOG_ORDER = [...CATALOGS.map((c) => c.name), "Other"];

export function filterBar(docs, onChange, { placeholder = "Search" } = {}) {
  let state = readFilters();
  const bar = el("div", "search");

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
  for (const f of FILTERS) {
    const values = [...new Set(docs.flatMap((d) => d.values[f.key]))]
      .sort((a, b) => (f.key === "catalog" ? CATALOG_ORDER.indexOf(a) - CATALOG_ORDER.indexOf(b) : a.localeCompare(b)));
    // A filter with only one choice wouldn't narrow anything.
    if (values.length < 2 && !state[f.key]) continue;
    const select = el("select");
    select.append(new Option("Any", ""), ...values.map((v) => new Option(v, v)));
    controls[f.key] = select;
    panel.append(labelled(f.label, select));
  }
  for (const [key, text] of [["from", "From"], ["to", "To"]]) {
    const date = el("input");
    date.type = "date";
    controls[key] = date;
    panel.append(labelled(text, date));
  }
  const todo = el("input");
  todo.type = "checkbox";
  controls.todo = todo;
  const todoLabel = el("label", "filter check");
  todoLabel.append(todo, " Has to-dos");
  panel.append(todoLabel);

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
