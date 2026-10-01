/* site/d-data.js — behaviour module (IIFE). OWNER: Agent D. Loaded after site.js.
   Data-viz details layered on top of site.js (which keeps the core logic):
     • city:pick  (3D score city tap) → same "why this score" drawer as the heatmap cell + axis focus
*/
(() => {
  "use strict";
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const dataEl = $("#site-data"); if (!dataEl) return;
  const DATA = JSON.parse(dataEl.textContent);
  const RI = Object.fromEntries(DATA.regions.map((r, i) => [r.id, i]));
  const AI = Object.fromEntries(DATA.axes.map((a, i) => [a.id, i]));

  /* ---------------- 3D city → drawer ---------------- */
  document.addEventListener("city:pick", (e) => {
    const { region, axis } = e.detail || {};
    if (!(region in RI) || !(axis in AI)) return;
    const chip = $(`.axis-chips .chip[data-axis="${axis}"]`);
    if (chip && chip.getAttribute("aria-pressed") !== "true") chip.click();
    // heat cells are laid out axis-major (row = axis, column = region) → reuse the cell's drawer
    const cell = $$(".heat-cell")[AI[axis] * DATA.regions.length + RI[region]];
    if (cell) cell.click();
  });
})();
