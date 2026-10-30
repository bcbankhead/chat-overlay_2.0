// The Profile flyout's only contact with the engine's page globals and its own controls.
// Font and colour live only in the engine's textFamily / textColor; nothing here keeps a copy.

import { profileID } from '../rail/menuModel.js';
import { readRow } from '../rail/rowParse.js';
import { safeDecodeURI } from '../../core/parse.js';
import { colorList, fontList, styleCookie } from './textStyle.js';

/** Days the engine keeps `myTextStyle` (message.js.php:289). */
const COOKIE_DAYS = 30;

/**
 * @param {Window} win
 * @param {Document} doc
 */
export function createEngine(win, doc) {
  const w = /** @type {any} */ (win);

  /** @param {string} name */
  function fn(name) {
    if (typeof w[name] !== 'function') throw new Error(`the chat engine has no ${name}()`);
    return w[name];
  }

  const ownAvatar = () => /** @type {HTMLImageElement | null} */ (doc.getElementById(`avatar_${w.uID}`));

  return {
    /** Own avatar src and display name. */
    self() {
      return {
        avatar: ownAvatar()?.getAttribute('src') ?? '',
        name: safeDecodeURI(String(w.userName ?? '')),
      };
    },

    /**
     * Open own profile, as userPanel's View Profile does; false when profiles are off or
     * your own row is not in the list yet.
     */
    canViewProfile() {
      return Boolean(w.profileOn) && Boolean(this.ownRow());
    },

    ownRow() {
      const row = ownAvatar()?.closest('.userlist');
      return row ? readRow(row) : null;
    },

    viewProfile() {
      if (!w.profileOn) throw new Error('profiles are off in the chat engine');
      const user = this.ownRow();
      if (!user) throw new Error('your own row is not in the user list yet');
      fn('viewProfile')(profileID(user, w.profileRef), user.rawName);
    },

    /** `#selectStatusID`'s value, or null when the engine has not built it. */
    statusValue() {
      const sel = /** @type {HTMLSelectElement | null} */ (doc.getElementById('selectStatusID'));
      return sel ? sel.value : null;
    },

    /**
     * Set status as the engine's own select does (functions.js.php:448), keeping that select
     * on the same value so it reads back correctly next time.
     * @param {number} index
     */
    sendStatus(index) {
      const send = fn('sendStatus');
      const sel = /** @type {HTMLSelectElement | null} */ (doc.getElementById('selectStatusID'));
      if (sel) sel.value = String(index);
      send(String(index));
    },

    /** The `#eCreditsID` element, or null. */
    creditsElement() {
      return doc.getElementById('eCreditsID');
    },

    openCredits() {
      const icon = doc.getElementById('iconeCredits');
      if (!icon) throw new Error('the chat engine has no eCredits control');
      icon.click();
    },

    fonts() {
      return fontList(w.myFontFamily);
    },

    colors() {
      return colorList(w.myColor);
    },

    /** The current choice, as the engine holds it. */
    style() {
      return {
        textFamily: typeof w.textFamily === 'string' ? w.textFamily : '',
        textColor: typeof w.textColor === 'string' ? w.textColor : '',
      };
    },

    /**
     * Apply a font or colour as the engine's Text Options would, then persist it in the
     * engine's own cookie so it survives a reload without a message being sent.
     * @param {{ textFamily?: string, textColor?: string }} choice
     */
    setStyle(choice) {
      const apply = fn('changeMessBoxStyle');
      const save = fn('createCookie');
      if (choice.textFamily !== undefined) w.textFamily = choice.textFamily;
      if (choice.textColor !== undefined) w.textColor = choice.textColor;
      apply('optionsBar');
      save(
        'myTextStyle',
        styleCookie({
          mBold: w.mBold,
          mItalic: w.mItalic,
          mUnderline: w.mUnderline,
          textColor: w.textColor,
          textSize: w.textSize,
          textFamily: w.textFamily,
        }),
        COOKIE_DAYS,
      );
    },
  };
}

/** @typedef {ReturnType<typeof createEngine>} ProfileEngine */
