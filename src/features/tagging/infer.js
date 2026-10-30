// Tag inference from a room's stored messages. Pure: every install reads the same messages,
// so every install derives the same tags without a shared server, and a tag cannot exist
// without the message that produced it.
//
// Only public messages count (A1): another install never sees a whisper. An own message
// whose send failed (`unconfirmed`) never reached anyone else, so it counts for nothing.
// Messages are ordered by receivedAt, then id (B2): own messages keep their local id.

import { extractShareIds } from '../gallery/shareParse.js';
import { parseReaction } from './reactions.js';

/**
 * The fields inference reads from a stored message.
 * @typedef {Pick<import('../../core/history.js').MessageRecord,
 *   'id' | 'roomID' | 'user' | 'kind' | 'text' | 'receivedAt' | 'confirm'>} InferMessage
 */

/**
 * One reaction to one image by one sender.
 * @typedef {object} Tag
 * @property {string} imageId          the share id
 * @property {string} code             the smilie code
 * @property {string} sender
 * @property {string} roomID
 * @property {string} sourceMessageId  the reaction message
 * @property {boolean} certain         the sender is you
 */

/**
 * @param {InferMessage} a
 * @param {InferMessage} b
 */
function byArrival(a, b) {
  if (a.receivedAt !== b.receivedAt) return a.receivedAt - b.receivedAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * @param {string} imageId
 * @param {string} code
 * @param {string} sender
 */
const tagKey = (imageId, code, sender) => `${imageId}\n${code}\n${sender}`;

/**
 * Every tag the room's messages produce, one per (image, code, sender), in the order each
 * was first made.
 * @param {readonly InferMessage[]} roomMessages
 * @param {string} me  this install's user name, as messages store it
 * @param {readonly string[]} codes  the engine's smilie codes
 * @returns {Tag[]}
 */
export function deriveTags(roomMessages, me, codes) {
  const messages = roomMessages.filter((m) => m.kind === 'public' && m.confirm !== 'unconfirmed').sort(byArrival);
  /** @type {Map<string, Tag>} */
  const tags = new Map();
  /** @type {string[][]} share ids of each message, by position */
  const shares = messages.map((m) => extractShareIds(m.text));

  /**
   * @param {string} imageId
   * @param {InferMessage} m
   * @param {string} code
   */
  const add = (imageId, m, code) => {
    const key = tagKey(imageId, code, m.user);
    if (tags.has(key)) return;
    tags.set(key, {
      imageId,
      code,
      sender: m.user,
      roomID: m.roomID,
      sourceMessageId: m.id,
      certain: m.user === me,
    });
  };

  messages.forEach((m, i) => {
    const reaction = parseReaction(m.text, codes);
    if (!reaction) return;
    if (reaction.suffix === null) {
      // The strict rule: a bare reaction tags only the message directly before it.
      for (const imageId of i > 0 ? shares[i - 1] : []) add(imageId, m, reaction.code);
      return;
    }
    const suffix = reaction.suffix;
    let imageId = null;
    for (let j = i - 1; j >= 0 && imageId === null; j -= 1) {
      for (const id of shares[j]) if (id.endsWith(suffix)) imageId = id;
    }
    if (imageId === null) return;
    if (reaction.retract) tags.delete(tagKey(imageId, reaction.code, m.user));
    else add(imageId, m, reaction.code);
  });

  return [...tags.values()];
}

/**
 * @typedef {object} ReactionCount
 * @property {string} code
 * @property {number} count
 * @property {boolean} mine
 * @property {string[]} senders
 */

/**
 * One row per code on the image, in first-reaction order.
 * @param {readonly Tag[]} tags
 * @param {string} imageId
 * @returns {ReactionCount[]}
 */
export function countReactions(tags, imageId) {
  /** @type {Map<string, ReactionCount>} */
  const rows = new Map();
  for (const tag of tags) {
    if (tag.imageId !== imageId) continue;
    let row = rows.get(tag.code);
    if (!row) rows.set(tag.code, (row = { code: tag.code, count: 0, mine: false, senders: [] }));
    row.count += 1;
    row.senders.push(tag.sender);
    if (tag.certain) row.mine = true;
  }
  return [...rows.values()];
}
