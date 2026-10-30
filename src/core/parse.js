// Pure parsing of the engine's wire formats (Pro Chat Rooms v8.4.2).
// Engine source: reference/site-js/message.js.php (read by absolute path, see TDF-0009).

/**
 * One `usermessage` node from getData.php, split on `}{` (message.js.php:635).
 * @typedef {object} ServerMessage
 * @property {string} id        field [0], the server message id
 * @property {string} uid       field [1]
 * @property {string} targetDiv field [2], `chatContainer` or `pcontent_*`
 * @property {string} user      field [3]
 * @property {string} toUser    field [4]
 * @property {string} body      field [5], URI-encoded `|`-delimited body
 * @property {string} sfx       field [7]
 * @property {string} mTime     field [8], server unix time (not unique)
 */

/**
 * A message body, split on `|` after `decodeURI` (message.js.php:736, :892).
 * @typedef {object} MessageBody
 * @property {string} avatar
 * @property {string} color
 * @property {string} size
 * @property {string} family
 * @property {string} text
 * @property {string} ircFlag
 * @property {string} lineBreakFlag
 */

/** @typedef {'public' | 'whisper' | 'entry' | 'exit' | 'system'} MessageKind */

/** The engine's main chat container id; private windows are `pcontent_*`. */
export const MAIN_DIV = 'chatContainer';

/** Avatar value the engine uses for its own notices (message.js.php:1007). */
export const NOTICE_AVATAR = '../images/notice.gif';

/** Prefix the engine gives a whisper's text (message.js.php:281). */
export const WHISPER_PREFIX = ' &#187; ';

/**
 * `decodeURI` that returns its input instead of throwing on a malformed sequence.
 * @param {string} value
 * @returns {string}
 */
export function safeDecodeURI(value) {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

/**
 * `decodeURIComponent` that returns its input instead of throwing.
 * @param {string} value
 * @returns {string}
 */
export function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * @param {string} raw the `usermessage` text content
 * @returns {ServerMessage}
 */
export function parseUserMessage(raw) {
  const f = raw.split('}{');
  return {
    id: f[0] ?? '',
    uid: f[1] ?? '',
    targetDiv: f[2] ?? '',
    user: f[3] ?? '',
    toUser: f[4] ?? '',
    body: f[5] ?? '',
    sfx: f[7] ?? '',
    mTime: f[8] ?? '',
  };
}

/**
 * Split a body into its 5–7 fields. The share plugin sends only five (reference/ANALYSIS.md).
 * @param {string} body the body as passed to createMessageDiv
 * @returns {MessageBody}
 */
export function parseBody(body) {
  const f = safeDecodeURI(body).split('|');
  return {
    avatar: f[0] ?? '',
    color: f[1] ?? '',
    size: f[2] ?? '',
    family: f[3] ?? '',
    text: f[4] ?? '',
    ircFlag: f[5] ?? '',
    lineBreakFlag: f[6] ?? '',
  };
}

/**
 * toUser values that name no recipient. The server sends `_` on public main-room messages
 * (TDF-0012); the engine itself never reads toUser to mark a whisper.
 * @type {ReadonlySet<string>}
 */
export const NO_RECIPIENT = new Set(['', '_']);

/**
 * Whether a message is a whisper: a real toUser in the main room, or the whisper text prefix.
 * @param {{ targetDiv: string, toUser: string, body: { text: string, ircFlag: string } }} msg
 * @returns {boolean}
 */
export function isWhisper({ targetDiv, toUser, body }) {
  // The local echo of an own whisper carries no toUser (message.js.php:297).
  if (body.ircFlag === '1' && body.text.startsWith(WHISPER_PREFIX)) return true;
  return targetDiv === MAIN_DIV && !NO_RECIPIENT.has(toUser);
}

/**
 * Derive a message's kind (Locked: kind derived from toUser, avatar flag and body).
 * @param {{ targetDiv: string, toUser: string, body: MessageBody }} msg
 * @param {{ publicEntry: string, publicExit: string }} lang the engine's lang strings
 * @returns {MessageKind}
 */
export function classify(msg, lang) {
  const { body } = msg;
  if (body.avatar === NOTICE_AVATAR) return 'system';
  if (body.avatar === '1') {
    if (lang.publicExit && body.text.includes(lang.publicExit)) return 'exit';
    return 'entry';
  }
  return isWhisper(msg) ? 'whisper' : 'public';
}

/**
 * The recipient named in a whisper's text prefix, or '' when there is none.
 * @param {string} text
 * @returns {string}
 */
export function whisperTarget(text) {
  if (!text.startsWith(WHISPER_PREFIX)) return '';
  const rest = text.slice(WHISPER_PREFIX.length);
  const colon = rest.indexOf(':');
  return colon === -1 ? '' : safeDecodeURI(rest.slice(0, colon));
}

/**
 * The mTime an admin `DELETEMESSAGE_<mTime>` targets, or null (message.js.php:745-765).
 * @param {string} message the whole decoded message, as createMessageDiv sees it
 * @returns {string | null}
 */
export function isDelete(message) {
  if (!message.includes('DELETEMESSAGE_')) return null;
  const fields = message.replace('DELETEMESSAGE_', '').split('|');
  const target = (fields[4] ?? '').replace(/\[\/?[biu]\]/gi, '').replace(/ /g, '');
  return target === '' ? null : target;
}
