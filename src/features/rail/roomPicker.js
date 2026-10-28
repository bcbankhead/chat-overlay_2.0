// Room picker: every room with its count; choosing another calls the engine's changeRooms,
// a full reload (functions.js.php:232), after which the message view replays that room.

/**
 * @param {{
 *   doc: Document,
 *   rooms: import('./rowParse.js').RailRoom[],
 *   current: string,
 *   onPick: (roomID: string) => void,
 * }} deps
 */
export function renderRoomPicker({ doc, rooms, current, onPick }) {
  const label = doc.createElement('label');
  label.className = 'tdf-rail-field';
  label.append('Room ');
  const select = doc.createElement('select');
  select.className = 'tdf-rail-room';
  for (const room of rooms) {
    const option = doc.createElement('option');
    option.value = room.roomID;
    option.textContent = `${room.name || room.roomID} (${room.count})`;
    select.appendChild(option);
  }
  select.value = current;
  select.addEventListener('change', () => {
    if (select.value !== current) onPick(select.value);
  });
  label.appendChild(select);
  return label;
}
