// The message view: a linear list overlaid on #chatContainer. The engine's container stays
// in the DOM, hidden, so its scrolling and trimming keep working underneath.

import { expand } from './expand.js';
import { clockHHMM, continuesGroup, groupTime } from './group.js';
import { DEFAULT_REPLAY_LIMIT } from './history.js';
import { adapt, luminance, parseColor, THEME_BG } from './ink.js';
import { safeDecodeURIComponent } from './parse.js';
import { sanitize } from './sanitize.js';
import { attachScrollbar } from './shell.js';

/**
 * What the view renders: a stored record, or an engine-local notice with no id.
 * @typedef {Omit<import('./history.js').MessageRecord, 'id'> & { id: string | null }} ViewRecord
 */

/** Kinds that are the view's own voice: muted, never in a sender colour. */
const NOTICE_KINDS = new Set(['entry', 'exit', 'system']);

/** Images larger than this on either side are posted images; smaller ones are smilies. */
const POSTED_MIN_PX = 48;

/**
 * Tag a posted image once its size is known, so it takes the pointer and the hover fade.
 * @param {HTMLImageElement} img
 */
function tagPosted(img) {
  if (img.naturalWidth > POSTED_MIN_PX || img.naturalHeight > POSTED_MIN_PX) {
    img.classList.add('tdf-posted');
  }
}

/**
 * What grouping reads from a rendered row, or null for a row that is not a record.
 * @param {HTMLElement} row
 * @returns {import('./group.js').GroupKey | null}
 */
function groupKey(row) {
  const { kind, user = '', t } = row.dataset;
  return kind === undefined ? null : { user, kind, t: Number(t) };
}

/**
 * Mark a chat row `tdf-head` or `tdf-cont` from the row before it. Notices carry neither,
 * and break the group for the row after them.
 * @param {Element | null} el
 */
function regroup(el) {
  const row = /** @type {HTMLElement | null} */ (el);
  const key = row && groupKey(row);
  if (!row || !key || (key.kind !== 'public' && key.kind !== 'whisper')) return;
  const prev = /** @type {HTMLElement | null} */ (row.previousElementSibling);
  const cont = continuesGroup(prev && groupKey(prev), key);
  row.classList.toggle('tdf-cont', cont);
  row.classList.toggle('tdf-head', !cont);
}

/**
 * Theme-independent ink class: which background the sender colour is illegible on. The
 * view no longer uses it (messages take ink.js's colour shift); the composer still does.
 * @param {string} color
 */
export function inkClass(color) {
  const rgb = parseColor(color);
  if (!rgb) return null;
  const l = luminance(rgb);
  if (l < 0.13) return 'tdf-ink-dark'; // under 3:1 against the dark background
  if (l > 0.3) return 'tdf-ink-light'; // under 3:1 against the light background
  return null;
}

/**
 * @param {{
 *   doc: Document,
 *   win: Window & { addSmilie?: (text: string) => string, enableEmail?: unknown, enableUrl?: unknown },
 *   container: HTMLElement,
 *   css: string,
 * }} deps
 */
export function createView({ doc, win, container, css }) {
  const style = doc.createElement('style');
  style.id = 'tdf-chat-style';
  style.textContent = css;
  doc.head.appendChild(style);

  const root = doc.createElement('div');
  root.id = 'tdf-chat';
  const list = doc.createElement('div');
  list.className = 'tdf-list';
  root.appendChild(list);
  attachScrollbar(list);

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

  // Posted images are told from smilies by size, known only once loaded. `load` does not
  // bubble, so it is caught in the capture phase.
  list.addEventListener(
    'load',
    (event) => {
      const target = /** @type {Element} */ (event.target);
      if (target.tagName === 'IMG' && target.closest?.('.tdf-body')) {
        tagPosted(/** @type {HTMLImageElement} */ (target));
      }
    },
    true,
  );

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
    if (record.id !== null) el.dataset.id = record.id;
    if (record.mTime) el.dataset.mtime = record.mTime;
    const t = groupTime(record);
    el.dataset.kind = record.kind;
    el.dataset.user = record.user;
    el.dataset.t = String(t);
    const chat = record.kind === 'public' || record.kind === 'whisper';

    // Sender family and size are ignored: every message uses the UI font (theme.css).
    const line = doc.createElement('span');
    line.className = 'tdf-line';
    // The sender colour, shifted per theme until legible; theme.css picks the theme's.
    // '' leaves the property unset, so the line takes the theme's text colour.
    if (record.color && !NOTICE_KINDS.has(record.kind)) {
      for (const theme of /** @type {const} */ (['light', 'dark'])) {
        const ink = adapt(record.color, THEME_BG[theme]);
        if (ink) line.style.setProperty(`--tdf-ink-${theme}`, ink);
      }
    }

    if (chat) {
      const avatar = doc.createElement('img');
      avatar.className = 'tdf-avatar';
      avatar.alt = '';
      avatar.setAttribute('loading', 'lazy');
      // A failed avatar falls back to the neutral square, as a missing one does. Expected and
      // harmless: a deleted or broken avatar file loses only the picture, never the message.
      avatar.addEventListener('error', () => avatar.removeAttribute('src'));
      if (record.avatar) avatar.src = `avatars/40/${encodeURIComponent(record.avatar)}`;
      el.appendChild(avatar);
    }

    const showName = record.user && record.kind !== 'entry' && record.kind !== 'exit';
    if (showName) {
      const name = doc.createElement('span');
      name.className = record.ircFlag === '1' ? 'tdf-user' : 'tdf-user tdf-sep';
      name.dataset.user = record.user;
      name.textContent = safeDecodeURIComponent(record.user);
      line.appendChild(name);
    }
    if (chat) {
      const time = doc.createElement('span');
      time.className = 'tdf-time';
      time.textContent = clockHHMM(t);
      line.appendChild(time);
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
    for (const img of body.querySelectorAll('img')) if (img.complete) tagPosted(img);
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

  /**
   * Remove a row; the row after it may now head its own group.
   * @param {HTMLElement} el
   */
  function remove(el) {
    const next = el.nextElementSibling;
    unindex(el);
    el.remove();
    regroup(next);
  }

  // Live, and counting entries only: the floating scrollbar's thumb is in the list too.
  const shown = list.getElementsByClassName('tdf-msg');

  // The list keeps no more than a replay shows; the oldest entries go first.
  function trim() {
    while (shown.length > DEFAULT_REPLAY_LIMIT) {
      remove(/** @type {HTMLElement} */ (shown[0]));
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
      const el = add(record);
      list.appendChild(el);
      regroup(el);
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
      for (const el of els) regroup(el);
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
        const replacement = add(record);
        el.replaceWith(replacement);
        regroup(replacement);
        regroup(replacement.nextElementSibling);
      }
    },

    /** @param {string} id */
    markUnconfirmed(id) {
      for (const el of entries('id', id)) {
        el.classList.remove('tdf-pending');
        el.classList.add('tdf-unconfirmed');
      }
    },

    /**
     * Remove the first rendered entry with that mTime, as the engine removes only the first
     * div with that id; later same-second entries stay.
     * @param {string} mTime
     */
    removeByMTime(mTime) {
      const [first] = entries('mtime', mTime).sort((a, b) =>
        a.compareDocumentPosition(b) & 4 /* DOCUMENT_POSITION_FOLLOWING */ ? -1 : 1,
      );
      if (first) remove(first);
    },

    notice,
  };
}

/** @typedef {ReturnType<typeof createView>} View */
