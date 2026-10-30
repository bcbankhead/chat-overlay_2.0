// Pure port of the engine's userPanel menu gating (userlist.js.php:351-518). Each action is
// a list of engine calls, made by engine.js, with the exact arguments the engine's own
// onclick handlers pass — so behaviour matches the original panel. Whisper and Clear Whisper
// are not here: the name menu (nameMenu.js) puts its own Whisper / Stop whispering first.

import { safeDecodeURI } from '../../core/parse.js';

/**
 * An engine call: function name, then its arguments.
 * @typedef {[string, ...string[]]} EngineCall
 */

/**
 * @typedef {object} MenuAction
 * @property {string} id
 * @property {string} label
 * @property {EngineCall[]} calls
 */

/**
 * Engine globals the gating reads, as found on `window` (loosely typed, as the engine is).
 * @typedef {object} EngineFlags
 * @property {unknown} uID          own chat id
 * @property {unknown} userName     own name, as the engine passes it
 * @property {unknown} privateOn
 * @property {unknown} webcamsOn
 * @property {unknown} profileOn
 * @property {unknown} profileRef   0 = uuID, 1 = name, 2 = forum userID
 * @property {unknown} groupPChat
 * @property {unknown} groupWatch
 * @property {unknown} eCredits
 * @property {boolean} noCredits    `#eCreditsID` reads `'0'`
 * @property {unknown} share
 * @property {unknown} admin
 * @property {unknown} moderator
 * @property {unknown} roomOwner
 * @property {unknown} moderatedChat
 * @property {unknown} styleFolder
 * @property {unknown} intelliBotName
 * @property {Record<string, unknown>} lang the engine's `lang<N>` strings
 */

/** English fallbacks for the engine's `lang<N>` strings (lang.js.php). */
const LANG = {
  lang6: 'Your user group does not have permission to use this feature',
  lang32: 'You do not have any eCredits',
  lang33: 'Private Chat',
  lang35: 'View Webcam',
  lang36: 'View Profile',
  lang37: 'Block User',
  lang38: 'Unblock User',
  lang39: 'Report User',
  lang40: 'Silence',
  lang41: 'Kick',
  lang42: 'Ban',
  lang43: 'Moderated Chat',
};

/** @typedef {keyof typeof LANG} LangKey */

/**
 * The engine's loose `==`, kept deliberately: its globals mix numbers and strings.
 * @param {unknown} a
 * @param {unknown} b
 */
const looseEq = (a, b) => /** @type {any} */ (a) == b;

/**
 * @param {EngineFlags} flags
 * @param {LangKey} key
 */
function lang(flags, key) {
  const value = flags.lang[key];
  return typeof value === 'string' && value ? value : LANG[key];
}

/**
 * `showInfoBox("system", ...)`, the engine's message box (functions.js.php:1102).
 * @param {string} text
 * @returns {EngineCall}
 */
const infoBox = (text) => ['showInfoBox', 'system', '220', '300', '200', '', text];

/**
 * The profile id `userPanel` passes to `viewProfile`, per `profileRef`.
 * @param {import('./rowParse.js').RailUser} user
 * @param {unknown} profileRef
 */
export function profileID(user, profileRef) {
  switch (Number(profileRef)) {
    case 0:
      return user.uuID;
    case 1:
      return user.rawName;
    case 2:
      return user.userID;
    default:
      return '';
  }
}

/**
 * The built-in menu for one user, whisper aside, in `userPanel`'s order and under its exact gates.
 * @param {import('./rowParse.js').RailUser} user
 * @param {EngineFlags} flags
 * @returns {MenuAction[]}
 */
export function builtInActions(user, flags) {
  /** @type {MenuAction[]} */
  const actions = [];
  const name = user.rawName;
  // Intelli-bot has no menu (userlist.js.php:354).
  if (typeof flags.intelliBotName === 'string' && name.toLowerCase() === flags.intelliBotName.toLowerCase()) {
    return actions;
  }
  const self = looseEq(flags.uID, user.uuID);
  const noCredits = looseEq(flags.eCredits, 1) && flags.noCredits;
  const staff = Boolean(flags.admin) || Boolean(flags.moderator);

  /**
   * The credit and group gate shared by private chat and webcam.
   * @param {unknown} group
   * @param {EngineCall[]} allowed
   * @returns {EngineCall[]}
   */
  const gated = (group, allowed) => {
    if (noCredits) return [infoBox(lang(flags, 'lang32'))];
    if (looseEq(group, 0)) return [infoBox(lang(flags, 'lang6'))];
    return allowed;
  };

  if (flags.privateOn && !self) {
    actions.push({
      id: 'private',
      label: lang(flags, 'lang33'),
      calls: gated(flags.groupPChat, [
        ['clearWhisper'],
        ['createPChatDiv', String(flags.userName ?? ''), name, user.uuID, String(flags.uID ?? '')],
      ]),
    });
  }

  if (flags.webcamsOn && !self) {
    actions.push({ id: 'webcam', label: lang(flags, 'lang35'), calls: gated(flags.groupWatch, [['requestViewWebcam', name]]) });
  }

  if (flags.profileOn) {
    actions.push({ id: 'profile', label: lang(flags, 'lang36'), calls: [['viewProfile', profileID(user, flags.profileRef), name]] });
  }

  if (!self && flags.share) {
    actions.push({
      id: 'share',
      label: 'Share Files',
      calls: [['showInfoBox', 'shareFiles', '280', '300', '200', `plugins/share/?shareWithUser=${name}`, '']],
    });
  }

  if (!self && looseEq(user.block, 1)) {
    const shown = safeDecodeURI(name);
    actions.push(
      { id: 'block', label: lang(flags, 'lang37'), calls: [['blockUsers', 'block', user.uuID], infoBox(`You have blocked ${shown}`)] },
      { id: 'unblock', label: lang(flags, 'lang38'), calls: [['blockUsers', 'unblock', user.uuID], infoBox(`You have unblocked ${shown}`)] },
      {
        id: 'report',
        label: lang(flags, 'lang39'),
        calls: [['showInfoBox', 'report', '280', '360', '200', `templates/${String(flags.styleFolder ?? 'default')}/report.php?id=${name}`, '']],
      },
    );
  }

  if (!self && (staff || Boolean(flags.roomOwner))) {
    actions.push(
      { id: 'silence', label: lang(flags, 'lang40'), calls: [['adminControls', name, 'SILENCE']] },
      { id: 'kick', label: lang(flags, 'lang41'), calls: [['adminControls', name, 'KICK']] },
    );
    if (staff) actions.push({ id: 'ban', label: lang(flags, 'lang42'), calls: [['adminControls', name, 'BAN']] });
  }

  if (!self && staff) {
    actions.push({ id: 'ip', label: `IP: ${user.ip}`, calls: [['newWin', `http://www.infosniper.net/index.php?ip_address=${user.ip}`]] });
  }

  if (self && flags.admin) {
    actions.push({ id: 'admin-area', label: 'Admin Area', calls: [['newWin', 'admin/']] });
  }

  if (self && looseEq(flags.moderatedChat, '1') && staff) {
    actions.push({
      id: 'moderated-chat',
      label: lang(flags, 'lang43'),
      calls: [['showInfoBox', 'mc', '400', '600', '100', 'plugins/moderated_chat/index.php', '']],
    });
  }

  return actions;
}
