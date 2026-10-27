// The message view: a linear list overlaid on #chatContainer. The engine's container stays
// in the DOM, hidden, so its scrolling and trimming keep working underneath.

import { describeError } from './errors.js';
import { expand } from './expand.js';
import { DEFAULT_REPLAY_LIMIT } from './history.js';
import { safeDecodeURIComponent } from './parse.js';
import { sanitize } from './sanitize.js';

/**
 * What the view renders: a stored record, or an engine-local notice with no id.
 * @typedef {Omit<import('./history.js').MessageRecord, 'id'> & { id: string | null }} ViewRecord
 */

const THEME_LABELS = { auto: 'Auto', light: 'Light', dark: 'Dark' };

/**
 * Relative luminance of a `#rgb`, `#rrggbb` or `rgb()` colour, or null.
 * @param {string} color
 */
function luminance(color) {
  let rgb = null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  } else {
    const fn = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color.trim());
    if (fn) rgb = fn.slice(1, 4).map(Number);
  }
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Theme-independent ink class: which background the sender colour is illegible on.
 * @param {string} color
 */
function inkClass(color) {
  const l = luminance(color);
  if (l === null) return null;
  if (l < 0.13) return 'tdf-ink-dark'; // under 3:1 against the dark background
  if (l > 0.3) return 'tdf-ink-light'; // under 3:1 against the light background
  return null;
}

/**
 * @param {{
 *   doc: Document,
 *   win: Window & { addSmilie?: (text: string) => string, enableEmail?: unknown, enableUrl?: unknown },
 *   container: HTMLElement,
 *   theme: import('./theme.js').Theme,
 *   css: string,
 * }} deps
 */
export function createView({ doc, win, container, theme, css }) {
  const style = doc.createElement('style');
  style.id = 'tdf-chat-style';
  style.textContent = css;
  doc.head.appendChild(style);

  const root = doc.createElement('div');
  root.id = 'tdf-chat';
  const list = doc.createElement('div');
  list.className = 'tdf-list';
  const toggle = doc.createElement('button');
  toggle.type = 'button';
  toggle.className = 'tdf-theme-toggle';
  toggle.title = 'Theme: auto → light → dark';
  toggle.addEventListener('click', () => {
    theme.cycle().catch((err) => notice(`Theme not saved: ${describeError(err)}`));
  });
  root.append(toggle, list);

  theme.onChange((mode) => {
    toggle.textContent = THEME_LABELS[mode];
  });
  theme.attach(root);

  container.insertAdjacentElement('afterend', root);
  container.style.visibility = 'hidden';

  const track = () => {
    root.style.top = `${container.offsetTop}px`;
    root.style.left = `${container.offsetLeft}px`;
    root.style.width = `${container.offsetWidth}px`;
    root.style.height = `${container.offsetHeight}px`;
  };
  track();
  if (typeof win.ResizeObserver === 'function') new win.ResizeObserver(track).observe(container);
  win.addEventListener('resize', track);

  // Clicking a sender name whispers them, as the engine's own name span does.
  list.addEventListener('click', (event) => {
    const target = /** @type {Element} */ (event.target);
    const name = target.closest?.('.tdf-user');
    const whisper = /** @type {any} */ (win).whisperUser;
    if (name && typeof whisper === 'function') whisper(name.getAttribute('data-user') ?? '');
  });

  const expandOptions = {
    smilie: (/** @type {string} */ text) =>
      typeof win.addSmilie === 'function' ? win.addSmilie(text) : text,
    enableEmail: win.enableEmail === undefined ? true : Boolean(Number(win.enableEmail)),
    enableUrl: win.enableUrl === undefined ? true : Boolean(Number(win.enableUrl)),
  };

  /** @param {ViewRecord} record */
  function render(record) {
    const el = doc.createElement('div');
    el.className = `tdf-msg tdf-kind-${record.kind}`;
    if (record.ircFlag === '1') el.classList.add('tdf-irc');
    if (record.confirm) el.classList.add(`tdf-${record.confirm}`);
    const ink = inkClass(record.color);
    if (ink) el.classList.add(ink);
    if (record.id !== null) el.dataset.id = record.id;
    if (record.mTime) el.dataset.mtime = record.mTime;

    const line = doc.createElement('span');
    line.className = 'tdf-line';
    if (record.color) line.style.color = record.color;
    if (record.family) line.style.fontFamily = record.family;

    const showName = record.user && record.kind !== 'entry' && record.kind !== 'exit';
    if (showName) {
      const name = doc.createElement('span');
      name.className = record.ircFlag === '1' ? 'tdf-user' : 'tdf-user tdf-sep';
      name.dataset.user = record.user;
      name.textContent = safeDecodeURIComponent(record.user);
      line.appendChild(name);
    }

    const body = doc.createElement('span');
    body.className = 'tdf-body';
    const content = sanitize(expand(record.text, expandOptions), doc);
    if (record.lineBreakFlag === '1') {
      const pre = doc.createElement('pre');
      pre.appendChild(content);
      body.appendChild(pre);
    } else {
      body.appendChild(content);
    }
    line.appendChild(body);
    el.appendChild(line);
    return el;
  }

  function autoscroll() {
    const auto = /** @type {HTMLInputElement | null} */ (doc.getElementById('autoScrollID'));
    if (!auto || auto.checked) list.scrollTop = list.scrollHeight;
  }

  /** @type {Set<string>} */
  const noticesShown = new Set();

  /**
   * Show a problem in the list itself, once per distinct text. Not stored.
   * @param {string} text
   */
  function notice(text) {
    if (noticesShown.has(text)) return;
    noticesShown.add(text);
    const el = doc.createElement('div');
    el.className = 'tdf-msg tdf-kind-system tdf-notice';
    el.setAttribute('role', 'status');
    el.textContent = text;
    list.appendChild(el);
    trim();
    autoscroll();
  }

  /** @type {Record<'id' | 'mtime', Map<string, Set<HTMLElement>>>} */
  const byKey = { id: new Map(), mtime: new Map() };

  /** @param {HTMLElement} el */
  function index(el) {
    for (const key of /** @type {const} */ (['id', 'mtime'])) {
      const value = el.dataset[key];
      if (value === undefined) continue;
      let set = byKey[key].get(value);
      if (!set) byKey[key].set(value, (set = new Set()));
      set.add(el);
    }
  }

  /** @param {HTMLElement} el */
  function unindex(el) {
    for (const key of /** @type {const} */ (['id', 'mtime'])) {
      const value = el.dataset[key];
      if (value === undefined) continue;
      const set = byKey[key].get(value);
      if (!set) continue;
      set.delete(el);
      if (set.size === 0) byKey[key].delete(value);
    }
  }

  /** @param {HTMLElement} el */
  function remove(el) {
    unindex(el);
    el.remove();
  }

  // The list keeps no more than a replay shows; the oldest entries go first.
  function trim() {
    while (list.childElementCount > DEFAULT_REPLAY_LIMIT) {
      remove(/** @type {HTMLElement} */ (list.firstElementChild));
    }
  }

  /** @param {ViewRecord} record */
  function add(record) {
    const el = render(record);
    index(el);
    return el;
  }

  /**
   * Rendered entries whose data attribute equals the value.
   * @param {'id' | 'mtime'} key
   * @param {string} value
   */
  const entries = (key, value) => [...(byKey[key].get(value) ?? [])];

  return {
    /** @param {ViewRecord} record */
    append(record) {
      list.appendChild(add(record));
      trim();
      autoscroll();
    },

    /** @param {ViewRecord[]} records oldest first */
    replay(records) {
      // Render every record before indexing any, so a throw leaves nothing behind.
      const els = records.map(render);
      const frag = doc.createDocumentFragment();
      for (const el of els) {
        index(el);
        frag.appendChild(el);
      }
      list.appendChild(frag);
      trim();
      autoscroll();
    },

    /**
     * An own message was confirmed by its send, or replaced by its server copy.
     * @param {string} pendingId
     * @param {ViewRecord} record
     */
    confirm(pendingId, record) {
      for (const el of entries('id', pendingId)) {
        unindex(el);
        el.replaceWith(add(record));
      }
    },

    /** @param {string} id */
    markUnconfirmed(id) {
      for (const el of entries('id', id)) {
        el.classList.remove('tdf-pending');
        el.classList.add('tdf-unconfirmed');
      }
    },

    /** @param {string} mTime */
    removeByMTime(mTime) {
      for (const el of entries('mtime', mTime)) remove(el);
    },

    notice,
  };
}

/** @typedef {ReturnType<typeof createView>} View */
