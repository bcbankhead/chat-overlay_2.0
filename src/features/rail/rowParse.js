/// <reference lib="dom" />
// Pure reading of the engine's rendered user list (Pro Chat Rooms v8.4.2).
// Engine source: reference/site-js/userlist.js.php (read by absolute path, see TDF-0009).
// Identity comes from row children and the room ancestor, never from the row id, which
// concatenates uuID and roomID with no separator (TDF-0009.3 Locked decisions).

import { safeDecodeURI } from '../../core/parse.js';

/**
 * One user in the engine's list, as `userPanel(...)` receives it (userlist.js.php:351).
 * @typedef {object} RailUser
 * @property {string} uuID       the user's chat id, from `avatar_<uuID>`
 * @property {string} name       display name, `decodeURI`d
 * @property {string} rawName    the name exactly as the engine passes it to its own calls
 * @property {string} roomID     from the enclosing `room_<roomID>` element
 * @property {string} userID     forum user id (`profileRef` 2)
 * @property {string} avatar     avatar file name under `avatars/`
 * @property {string} block      `'1'` when the user may be blocked (not admin/mod/speaker)
 * @property {string} ip
 * @property {string} statusText the `ustatusID_<uuID>` text, e.g. ` [BRB]` or ` [Idle]`
 */

/**
 * One room in the engine's list (userlist.js.php:306-327).
 * @typedef {object} RailRoom
 * @property {string} roomID
 * @property {string} name
 * @property {number} count
 * @property {RailUser[]} users
 */

/** `userPanel` argument order (userlist.js.php:74, :78). */
const ARG_COUNT = 8;

/**
 * The string arguments of an `onclick="userPanel(...)"` attribute, or null.
 * @param {string | null} onclick
 * @returns {string[] | null}
 */
export function parseUserPanelArgs(onclick) {
  if (!onclick) return null;
  const call = /userPanel\(([\s\S]*)\)/.exec(onclick);
  if (!call) return null;
  const args = [...call[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  return args.length === ARG_COUNT ? args : null;
}

/**
 * Read one `.userlist` row, or null when it is not a user row the engine rendered.
 * @param {Element} row
 * @returns {RailUser | null}
 */
export function readRow(row) {
  const avatar = row.querySelector('img[id^="avatar_"]');
  const nameSpan = row.querySelector('span[onclick*="userPanel("]');
  const room = row.closest('[id^="room_"]');
  if (!avatar || !nameSpan || !room) return null;
  const args = parseUserPanelArgs(nameSpan.getAttribute('onclick'));
  if (!args) return null;
  const uuID = avatar.id.slice('avatar_'.length);
  const [, rawName, , , userID, avatarFile, block, ip] = args;
  const status = row.querySelector(`[id="ustatusID_${uuID}"]`);
  return {
    uuID,
    name: safeDecodeURI(rawName),
    rawName,
    roomID: room.id.slice('room_'.length),
    userID,
    avatar: avatarFile,
    block,
    ip,
    statusText: (status?.textContent ?? '').replace(/ /g, ' '),
  };
}

/**
 * Read every room and its users from `#userContainer`.
 * @param {Element} container
 * @returns {RailRoom[]}
 */
export function readRooms(container) {
  /** @type {RailRoom[]} */
  const rooms = [];
  for (const el of Array.from(container.children)) {
    if (!el.id.startsWith('room_')) continue;
    const roomID = el.id.slice('room_'.length);
    const header = el.querySelector('.roomheader span');
    const count = el.querySelector(`[id="userCount_${roomID}"]`);
    /** @type {RailUser[]} */
    const users = [];
    for (const row of Array.from(el.querySelectorAll('.userlist'))) {
      const user = readRow(row);
      if (user) users.push(user);
    }
    rooms.push({
      roomID,
      name: (header?.textContent ?? '').replace(/ /g, ' ').trim(),
      count: Number(count?.textContent ?? users.length) || 0,
      users,
    });
  }
  return rooms;
}
