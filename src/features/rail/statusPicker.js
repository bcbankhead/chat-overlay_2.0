// Own status picker: Here / BRB / Away, sent with the engine's sendStatus(index)
// (functions.js.php:985). Idle stays the engine's own (idleTimeout, 900 s).

/**
 * @param {{
 *   doc: Document,
 *   statuses: { index: number, label: string }[],
 *   current: number,
 *   onPick: (index: number) => void,
 * }} deps
 */
export function renderStatusPicker({ doc, statuses, current, onPick }) {
  const label = doc.createElement('label');
  label.className = 'tdf-rail-field';
  label.append('Status ');
  const select = doc.createElement('select');
  select.className = 'tdf-rail-status';
  for (const { index, label: text } of statuses) {
    const option = doc.createElement('option');
    option.value = String(index);
    option.textContent = text;
    select.appendChild(option);
  }
  select.value = String(current);
  select.addEventListener('change', () => onPick(Number(select.value)));
  label.appendChild(select);
  return label;
}

/**
 * The status index a row's status text shows, e.g. ` [BRB]` → 2; Here shows nothing.
 * @param {string} statusText
 * @param {{ index: number, label: string }[]} statuses
 */
export function statusFromText(statusText, statuses) {
  const shown = /\[([^\]]*)\]/.exec(statusText)?.[1]?.trim();
  return statuses.find((s) => s.label === shown)?.index ?? null;
}
