// Phones can't show wide tables, so below 640px CSS turns each row into a card (see styles.css).
// The card layout needs each cell to know its column title; copy it from the header here so no
// page has to repeat it. Tables without a header row (key/value lists) are left alone.
export function startResponsiveTables() {
  const label = (table) => {
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    if (heads.length === 0) return;
    table.classList.add('stackable');
    for (const tr of table.querySelectorAll('tbody tr')) {
      let col = 0;
      for (const td of tr.children) {
        const span = td.colSpan || 1;
        if (span > 1) { td.removeAttribute('data-label'); col += span; continue; }
        const text = heads[col] || '';
        if (text) td.setAttribute('data-label', text); else td.removeAttribute('data-label');
        col += 1;
      }
    }
  };
  let queued = false;
  const run = () => {
    queued = false;
    document.querySelectorAll('table:not(.receipt table)').forEach(label);
  };
  new MutationObserver(() => {
    if (!queued) { queued = true; requestAnimationFrame(run); }
  }).observe(document.body, { childList: true, subtree: true });
  run();
}
