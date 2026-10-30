// The Profile flyout's contents (UI design 2026-10-27, Flyouts → Profile): your avatar and
// name, status, eCredits, then your text style — a preview line and Font / Colour accordions,
// closed by default. Every choice goes to the engine (engine.js); the view re-reads it.
// The preview is drawn in your colour shifted for the theme (ink.js), as the message box and
// messages are; the swatches and the Colour header show the raw colours being chosen.

import { renderAvatar } from '../../core/avatar.js';
import { describeError } from '../../core/errors.js';
import { createEngine } from './engine.js';
import { COLORS_PER_ROW, STATUSES, colorRows, sameChoice, statusIndex } from './textStyle.js';

const PREVIEW_TEXT = 'Your messages will look like this';

/**
 * The parts of src/core/shell.js and src/core/ink.js the flyout uses; injected so tests can
 * stub them.
 * @typedef {object} ProfileDeps
 * @property {Document} doc
 * @property {import('./engine.js').ProfileEngine} engine
 * @property {() => 'light' | 'dark' | null} currentTheme
 * @property {(fn: (theme: 'light' | 'dark') => void) => () => void} onThemeChange
 * @property {(color: string, theme: 'light' | 'dark') => string} shift
 *   the colour to paint on that theme (ink.js themeInk)
 * @property {(target: Node, fn: () => void) => () => void} observe
 * @property {() => import('../../core/avatarResolver.js').AvatarResolver | null} [avatars]
 *   forum pictures, read per render: the bootstrap publishes it after the flyout registers
 */

/** After Gallery in the icon row (UI design 2026-10-27, Sidebar). */
export const ORDER = 20;

/**
 * Inject the styles and register the Profile panel, once per page: a second copy of the
 * script finds the flag set and does nothing.
 * @param {{
 *   win: Window,
 *   doc: Document,
 *   css: string,
 *   icon: string,
 *   register: (panel: import('../rail/api.js').RailPanel) => unknown,
 *   currentTheme: ProfileDeps['currentTheme'],
 *   onThemeChange: ProfileDeps['onThemeChange'],
 *   shift: ProfileDeps['shift'],
 * }} deps
 * @returns {boolean} false when already started
 */
export function startProfile({ win, doc, css, icon, register, currentTheme, onThemeChange, shift }) {
  const w = /** @type {any} */ (win);
  if (w.__tdfChat2Profile) return false;
  w.__tdfChat2Profile = true;
  if (!doc.getElementById('tdf-profile-style')) {
    const style = doc.createElement('style');
    style.id = 'tdf-profile-style';
    style.textContent = css;
    doc.head.appendChild(style);
  }
  const engine = createEngine(win, doc);
  register({
    id: 'profile',
    title: 'Profile',
    icon,
    order: ORDER,
    render: (container) =>
      renderProfile(container, {
        doc,
        engine,
        currentTheme,
        onThemeChange,
        shift,
        avatars: () => w.__tdfChat2Avatars ?? null,
        observe(target, fn) {
          const observer = new w.MutationObserver(fn);
          observer.observe(target, { childList: true, characterData: true, subtree: true });
          return () => observer.disconnect();
        },
      }),
  });
  return true;
}

/**
 * Fill the flyout body.
 * @param {HTMLElement} container
 * @param {ProfileDeps} deps
 * @returns {() => void} cleanup
 */
export function renderProfile(container, { doc, engine, currentTheme, onThemeChange, shift, observe, avatars = () => null }) {
  /** @type {Array<() => void>} */
  const cleanups = [];
  const el = (/** @type {string} */ tag, /** @type {string} */ className, text = '') => {
    const node = doc.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  };

  const root = el('div', 'tdf-profile');
  const error = el('div', 'tdf-profile-error');
  error.setAttribute('role', 'status');
  error.hidden = true;
  /** @param {() => void} fn */
  const guarded = (fn) => {
    try {
      fn();
      error.hidden = true;
    } catch (err) {
      error.textContent = `Profile: ${describeError(err)}`;
      error.hidden = false;
    }
  };

  // Head: avatar and name; a button to your own profile only when the engine allows it.
  const self = engine.self();
  const linked = engine.canViewProfile();
  const head = el(linked ? 'button' : 'div', 'tdf-profile-head');
  if (linked) {
    /** @type {HTMLButtonElement} */ (head).type = 'button';
    head.title = 'View your profile';
    head.addEventListener('click', () => guarded(() => engine.viewProfile()));
  }
  // The engine's src is `avatars/<file>`; the file name says whether one was picked.
  const avatar = renderAvatar(doc, {
    name: self.name,
    userID: engine.ownRow()?.userID ?? '',
    file: self.avatar.split('/').pop() ?? '',
    src: self.avatar,
    className: 'tdf-profile-avatar',
    resolver: avatars(),
  });
  head.append(avatar, el('span', 'tdf-profile-name', self.name));

  // Status: read from the engine's select on every open.
  const status = el('div', 'tdf-profile-status');
  status.setAttribute('role', 'group');
  status.setAttribute('aria-label', 'Status');
  const current = statusIndex(engine.statusValue());
  for (const { index, label } of STATUSES) {
    const b = /** @type {HTMLButtonElement} */ (el('button', 'tdf-profile-seg', label));
    b.type = 'button';
    b.dataset.status = String(index);
    b.setAttribute('aria-pressed', String(index === current));
    b.addEventListener('click', () =>
      guarded(() => {
        engine.sendStatus(index);
        for (const s of status.children) s.setAttribute('aria-pressed', String(s === b));
      }),
    );
    status.appendChild(b);
  }

  // eCredits: the engine's own value, kept current while open; the row opens its box.
  const credits = /** @type {HTMLButtonElement} */ (el('button', 'tdf-profile-row tdf-profile-credits'));
  credits.type = 'button';
  credits.title = 'About eCredits';
  const creditValue = el('span', 'tdf-profile-value');
  credits.append(el('span', '', 'eCredits'), creditValue);
  const source = engine.creditsElement();
  const syncCredits = () => {
    creditValue.textContent = source ? (source.textContent ?? '').trim() : '–';
  };
  syncCredits();
  credits.addEventListener('click', () => guarded(() => engine.openCredits()));

  // Text style.
  const style = el('div', 'tdf-profile-style');
  const preview = el('div', 'tdf-profile-preview', PREVIEW_TEXT);
  const fontAcc = accordion('Font', 'tdf-profile-now-font');
  const colorAcc = accordion('Colour', 'tdf-profile-now-color');
  const fonts = el('div', 'tdf-profile-fonts');
  for (const font of engine.fonts()) {
    const b = /** @type {HTMLButtonElement} */ (el('button', 'tdf-profile-font', font));
    b.type = 'button';
    b.dataset.font = font;
    b.style.fontFamily = font;
    b.addEventListener('click', () => guarded(() => choose({ textFamily: font })));
    fonts.appendChild(b);
  }
  fontAcc.details.appendChild(fonts);
  const colors = el('div', 'tdf-profile-colors');
  colors.style.setProperty('--tdf-profile-per-row', String(COLORS_PER_ROW));
  for (const row of colorRows(engine.colors())) {
    for (const color of row) {
      const b = /** @type {HTMLButtonElement} */ (el('button', 'tdf-profile-color'));
      b.type = 'button';
      b.dataset.color = color;
      b.title = color;
      b.setAttribute('aria-label', color);
      b.style.background = color;
      b.addEventListener('click', () => guarded(() => choose({ textColor: color })));
      colors.appendChild(b);
    }
  }
  colorAcc.details.appendChild(colors);
  style.append(el('div', 'tdf-profile-title', 'Text style'), preview, fontAcc.details, colorAcc.details);

  /** @param {string} title @param {string} nowClass */
  function accordion(title, nowClass) {
    const details = /** @type {HTMLDetailsElement} */ (el('details', 'tdf-profile-acc'));
    const summary = el('summary', '');
    const now = el('span', nowClass);
    summary.append(el('span', 'tdf-profile-acc-title', title), now);
    details.appendChild(summary);
    return { details, now };
  }

  /** @param {{ textFamily?: string, textColor?: string }} choice */
  function choose(choice) {
    engine.setStyle(choice);
    paint();
  }

  function paintPreview() {
    const { textColor } = engine.style();
    const theme = currentTheme();
    if (!textColor) preview.style.color = '';
    else if (!theme) preview.style.color = textColor;
    else preview.style.color = shift(textColor, theme);
  }

  function paint() {
    const { textFamily, textColor } = engine.style();
    fontAcc.now.textContent = textFamily;
    fontAcc.now.style.fontFamily = textFamily;
    colorAcc.now.style.background = textColor || 'transparent';
    colorAcc.now.title = textColor;
    preview.style.fontFamily = textFamily;
    paintPreview();
    for (const b of /** @type {HTMLElement[]} */ ([...fonts.children])) {
      b.classList.toggle('tdf-on', sameChoice(b.dataset.font, textFamily));
    }
    for (const b of /** @type {HTMLElement[]} */ ([...colors.children])) {
      b.classList.toggle('tdf-on', sameChoice(b.dataset.color, textColor));
    }
  }
  paint();
  // Subscriptions last: a render that throws above returns no cleanup, so nothing may be attached yet.
  if (source) cleanups.push(observe(source, syncCredits));
  cleanups.push(onThemeChange(paintPreview));

  root.append(head, error, status, credits, style);
  container.appendChild(root);

  return () => {
    for (const fn of cleanups.splice(0)) fn();
  };
}
