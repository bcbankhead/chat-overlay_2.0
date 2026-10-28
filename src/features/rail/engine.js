// The rail's only contact with the engine's page globals: the flags userPanel gates on, and
// the functions its menu calls. Everything else in the rail goes through here.

import { safeDecodeURI } from './rowParse.js';

/** Engine functions a menu action may call (userlist.js.php userPanel's onclick handlers). */
const CALLABLE = new Set([
  'whisperUser',
  'clearWhisper',
  'blockUsers',
  'viewProfile',
  'createPChatDiv',
  'requestViewWebcam',
  'showInfoBox',
  'adminControls',
  'newWin',
]);

/** Engine `lang<N>` strings the menu labels with. */
const LANG_KEYS = ['lang6', 'lang32', 'lang33', 'lang34', 'lang35', 'lang36', 'lang37', 'lang38', 'lang39', 'lang40', 'lang41', 'lang42', 'lang43'];

/**
 * @param {Window} win
 * @param {Document} doc
 */
export function createEngine(win, doc) {
  const w = /** @type {any} */ (win);

  /** @returns {import('./menuModel.js').EngineFlags} */
  function flags() {
    /** @type {Record<string, unknown>} */
    const lang = {};
    for (const key of LANG_KEYS) lang[key] = w[key];
    const whisper = /** @type {HTMLInputElement | null} */ (doc.getElementById('whisperID'));
    return {
      uID: w.uID,
      userName: w.userName,
      privateOn: w.privateOn,
      whisperOn: w.whisperOn,
      webcamsOn: w.webcamsOn,
      profileOn: w.profileOn,
      profileRef: w.profileRef,
      groupPChat: w.groupPChat,
      groupWatch: w.groupWatch,
      eCredits: w.eCredits,
      noCredits: doc.getElementById('eCreditsID')?.innerHTML === '0',
      share: w.share,
      admin: w.admin,
      moderator: w.moderator,
      roomOwner: w.roomOwner,
      moderatedChat: w.moderatedChat,
      styleFolder: w.styleFolder,
      intelliBotName: w.intelliBotName,
      whispering: Boolean(whisper?.value),
      lang,
    };
  }

  /**
   * Make an action's engine calls, in order. A missing function stops the sequence.
   * @param {import('./menuModel.js').EngineCall[]} calls
   */
  function call(calls) {
    for (const [name, ...args] of calls) {
      if (!CALLABLE.has(name) || typeof w[name] !== 'function') {
        throw new Error(`the chat engine has no ${name}()`);
      }
      w[name](...args);
    }
  }

  return {
    flags,
    call,

    /** The room this page is in. */
    roomID() {
      return String(w.roomID ?? '');
    },

    /** Own chat id. */
    uID() {
      return String(w.uID ?? '');
    },

    /** Status labels Here / BRB / Away, by their `userStatusMes` index (settings.js.php). */
    statuses() {
      // The engine always defines userStatusMes; the fallback is its own value, not a guess.
      const mes = Array.isArray(w.userStatusMes) ? w.userStatusMes : ['select', 'Here', 'BRB', 'Away'];
      /** @type {{ index: number, label: string }[]} */
      const out = [];
      for (let i = 1; i < mes.length; i++) {
        out.push({ index: i, label: safeDecodeURI(String(mes[i])) });
      }
      return out;
    },

    /** The status index the engine's own selector holds, or null when it has not been built. */
    selectedStatus() {
      const sel = /** @type {HTMLSelectElement | null} */ (doc.getElementById('selectStatusID'));
      const index = sel ? Number(sel.value) : NaN;
      return index >= 1 ? index : null;
    },

    /** @param {number} index into `userStatusMes` */
    sendStatus(index) {
      if (typeof w.sendStatus !== 'function') throw new Error('the chat engine has no sendStatus()');
      // sendStatus drops the status unsent while a request is in flight (functions.js.php:991).
      const state = w.sendReq?.readyState;
      if (state !== undefined && state !== 0 && state !== 4) {
        throw new Error('the chat engine is busy sending; the status was not changed');
      }
      w.sendStatus(index);
      // Keep the engine's own selector, when built, in step with the rail's.
      const sel = /** @type {HTMLSelectElement | null} */ (doc.getElementById('selectStatusID'));
      if (sel) sel.value = String(index);
    },

    /** @param {string} roomID */
    changeRooms(roomID) {
      if (typeof w.changeRooms !== 'function') throw new Error('the chat engine has no changeRooms()');
      w.changeRooms(roomID);
    },
  };
}

/** @typedef {ReturnType<typeof createEngine>} Engine */
