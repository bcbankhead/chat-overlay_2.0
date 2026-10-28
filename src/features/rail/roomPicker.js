// The "Other rooms" row under the docked list: collapsed on every load; expanded, one text
// chip per room other than the current one, `name (count)`. A chip calls the engine's
// changeRooms, a full reload (functions.js.php:232), after which the message view replays
// that room.

import { ICONS, renderIcon } from './icons.js';

/**
 * How the rail names a room, here and in the docked list's heading.
 * @param {import('./rowParse.js').RailRoom} room
 */
export const roomLabel = (room) => `${room.name || room.roomID} (${room.count})`;

/**
 * @param {{
 *   doc: Document,
 *   rooms: import('./rowParse.js').RailRoom[],
 *   current: string,
 *   expanded: boolean,
 *   onToggle: () => void,
 *   onPick: (roomID: string) => void,
 * }} deps
 */
export function renderOtherRooms({ doc, rooms, current, expanded, onToggle, onPick }) {
  const others = rooms.filter((r) => r.roomID !== current);
  const row = doc.createElement('div');
  row.className = 'tdf-rail-rooms';
  const toggle = doc.createElement('button');
  toggle.type = 'button';
  toggle.className = 'tdf-rail-rooms-toggle';
  toggle.setAttribute('aria-expanded', String(expanded));
  const caret = doc.createElement('span');
  caret.className = 'tdf-rail-icon tdf-rail-caret';
  renderIcon(caret, ICONS.caret);
  toggle.append(caret, `Other rooms (${others.length})`);
  toggle.addEventListener('click', onToggle);
  row.appendChild(toggle);
  if (!expanded) return row;
  const chips = doc.createElement('div');
  chips.className = 'tdf-rail-room-chips';
  for (const room of others) {
    const chip = doc.createElement('button');
    chip.type = 'button';
    chip.className = 'tdf-rail-room';
    chip.dataset.room = room.roomID;
    chip.textContent = roomLabel(room);
    chip.addEventListener('click', () => onPick(room.roomID));
    chips.appendChild(chip);
  }
  row.appendChild(chips);
  return row;
}
