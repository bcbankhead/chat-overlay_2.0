// The Settings flyout (UI design 2026-10-27, Flyouts → Settings). Chat: the Auto-scroll switch
// over the engine's #autoScrollID, and Clear chat buffer. Storage: Chat history (days),
// Gallery size limit (MB), Include my images (TDF-0009.13) and Store images offline. A hint
// under each field says what the typed value would delete; the setting is written, and the
// deletion runs, only when the value is committed (change: Enter or leaving the field). The
// rail gives the flyout body its scrollbar.

import { describeError } from '../../core/errors.js';
import { clearView } from '../../core/events.js';
import { MB_BYTES, parseDays, parseMegabytes } from './selectors.js';

/**
 * @typedef {object} PanelDeps
 * @property {Document} doc
 * @property {Window} win
 * @property {import('../../core/settings.js').Settings} settings
 * @property {import('./limits.js').Limits} limits
 * @property {() => string | null} [loadFailure]  why the load-time limits did not run, if they failed
 */

/** @param {number} n @param {string} one */
const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
/** @param {number} bytes */
const megabytes = (bytes) => `${(bytes / MB_BYTES).toFixed(1)} MB`;

/**
 * Fill the flyout body; returns the cleanup the rail runs on close.
 * @param {HTMLElement} container
 * @param {PanelDeps} deps
 * @returns {() => void}
 */
export function renderSettings(container, { doc, win, settings, limits, loadFailure = () => null }) {
  /** @type {Array<() => void>} */
  const undo = [];
  let closed = false;

  /**
   * @template {keyof HTMLElementTagNameMap} K
   * @param {K} tag
   * @param {string} className
   * @param {string} [text]
   */
  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const root = el('div', 'tdf-opt');
  root.append(el('div', 'tdf-opt-title', 'Settings'));
  const failure = loadFailure();
  if (failure !== null) {
    root.append(el('div', 'tdf-opt-hint tdf-warn', `The storage limits did not run on load: ${failure}`));
  }
  root.append(el('div', 'tdf-opt-section tdf-opt-first', 'Chat'));

  // Auto-scroll: the engine's own checkbox, both ways; the engine reads it on every line.
  const scrollRow = el('label', 'tdf-opt-row');
  const scroll = el('input', 'tdf-opt-switch');
  scroll.type = 'checkbox';
  scrollRow.append(el('span', '', 'Auto-scroll'), scroll);
  const engineScroll = doc.getElementById('autoScrollID');
  if (engineScroll instanceof win.HTMLInputElement) {
    scroll.checked = engineScroll.checked;
    scroll.addEventListener('change', () => {
      engineScroll.checked = scroll.checked;
      engineScroll.dispatchEvent(new win.Event('change', { bubbles: true }));
    });
    const follow = () => {
      scroll.checked = engineScroll.checked;
    };
    engineScroll.addEventListener('change', follow);
    undo.push(() => engineScroll.removeEventListener('change', follow));
  } else {
    scroll.disabled = true;
  }

  // Clear chat buffer: the engine's clrScreen() for its hidden view, then the overlay's own
  // clear through core, so the view's index empties with its rows.
  const clear = el('button', 'tdf-opt-clear', 'Clear chat buffer');
  clear.type = 'button';
  clear.addEventListener('click', () => {
    const engineClear = /** @type {any} */ (win).clrScreen;
    if (typeof engineClear === 'function') engineClear();
    clearView();
  });

  root.append(
    scrollRow,
    clear,
    el('div', 'tdf-opt-hint', 'Empties the message view. Saved history is kept and returns on reload.'),
    el('div', 'tdf-opt-section', 'Storage'),
  );

  /**
   * @param {string} label
   * @param {string} placeholder
   */
  const field = (label, placeholder) => {
    const row = el('label', 'tdf-opt-field');
    const input = el('input', '');
    input.type = 'number';
    input.min = '0';
    input.step = '1';
    input.inputMode = 'numeric';
    input.placeholder = placeholder;
    row.append(el('span', '', label), input);
    const hint = el('div', 'tdf-opt-hint');
    hint.setAttribute('aria-live', 'polite');
    root.append(row, hint);
    return { input, hint };
  };

  const history = field('Chat history (days)', '');
  const gallery = field('Gallery size limit (MB)', 'No limit');
  gallery.input.min = '1';

  /**
   * A checkbox row over a boolean setting, written on change; its hint shows only a failure.
   * @param {'includeMyImages' | 'storeImagesOffline'} key
   * @param {string} label
   */
  const check = (key, label) => {
    const row = el('label', 'tdf-opt-row');
    const box = el('input', 'tdf-opt-check');
    box.type = 'checkbox';
    row.append(el('span', '', label), box);
    const hint = el('div', 'tdf-opt-hint tdf-warn');
    hint.setAttribute('aria-live', 'polite');
    root.append(row, hint);
    /** @param {string} text */
    const failed = (text) => {
      if (!closed) hint.textContent = text;
    };
    box.addEventListener('change', () => {
      hint.textContent = '';
      settings.set(key, box.checked).catch((err) => failed(`Could not apply: ${describeError(err)}`));
    });
    settings.get(key).then(
      (on) => {
        if (!closed) box.checked = on;
      },
      (err) => failed(`Could not read settings: ${describeError(err)}`),
    );
  };

  // Include my images: whether capture keeps the user's own shares, from the next share.
  check('includeMyImages', 'Include my images');
  // Store images offline: whether capture also keeps each new image's full copy, not only its
  // thumbnail, from the next share.
  check('storeImagesOffline', 'Store images offline');

  container.appendChild(root);

  /**
   * A hint whose text comes from an async read: only the latest call's result is shown.
   * @param {HTMLElement} hint
   */
  const hinter = (hint) => {
    let seq = 0;
    /**
     * @param {() => Promise<{ text: string, warn?: boolean }>} read
     */
    return async (read) => {
      const mine = ++seq;
      /** @type {{ text: string, warn?: boolean }} */
      let next;
      try {
        next = await read();
      } catch (err) {
        next = { text: `Could not check: ${describeError(err)}`, warn: true };
      }
      if (closed || mine !== seq) return;
      hint.textContent = next.text;
      hint.classList.toggle('tdf-warn', Boolean(next.warn));
    };
  };

  const showHistory = hinter(history.hint);
  const showGallery = hinter(gallery.hint);

  /** @type {number | null} the committed Chat history days; null is a stored legacy no-limit */
  let storedDays = null;

  // A number input the browser cannot parse ('-', 'e') reports '' — read as invalid, not empty.
  /** @param {HTMLInputElement} input */
  const valueOf = (input) => (input.validity?.badInput ? null : input.value);

  /** @param {string | null} input */
  const historyText = async (input) => {
    if (input !== null && input.trim() === '') {
      if (storedDays === null) return { text: 'Keeping all history. Enter 0 or more days to set a limit.' };
      return { text: `Enter 0 or more whole days. The current ${plural(storedDays, 'day')} limit stays.`, warn: true };
    }
    const parsed = input === null ? { ok: /** @type {const} */ (false) } : parseDays(input);
    if (!parsed.ok) return { text: 'Enter 0 or more whole days.', warn: true };
    const days = parsed.value;
    const n = await limits.previewHistory(days);
    const base =
      days === 0 ? 'No chat history is kept.' : `Lines older than ${plural(days, 'day')} are deleted, oldest first.`;
    return { text: base + (n ? ` This removes ${plural(n, 'line')} now.` : ''), warn: n > 0 };
  };

  /** @param {string | null} input */
  const galleryText = async (input) => {
    const parsed = input === null ? { ok: /** @type {const} */ (false) } : parseMegabytes(input);
    if (!parsed.ok) return { text: 'Enter 1 MB or more, or leave empty for no limit.', warn: true };
    const usage = await limits.previewGallery(parsed.value);
    const used = `${megabytes(usage.used)} used`;
    const { preview } = usage;
    if (!preview) return { text: `No limit. ${used}.` };
    const removes = preview.count
      ? ` This removes ${plural(preview.count, 'image')} (${megabytes(preview.bytes)}) now.`
      : '';
    return { text: `${used}. Oldest images go first; favorites are kept.${removes}`, warn: preview.count > 0 };
  };

  /** @param {string | null} input */
  const historyHint = (input) => showHistory(() => historyText(input));
  /** @param {string | null} input */
  const galleryHint = (input) => showGallery(() => galleryText(input));

  /**
   * Write the setting and apply it; the hint then reads the committed value, or the failure.
   * @param {(read: () => Promise<{ text: string, warn?: boolean }>) => Promise<void>} show
   * @param {() => Promise<unknown>} apply
   * @param {() => Promise<{ text: string, warn?: boolean }>} text
   */
  const commit = (show, apply, text) =>
    show(async () => {
      try {
        await apply();
      } catch (err) {
        return { text: `Could not apply: ${describeError(err)}`, warn: true };
      }
      return text();
    });

  history.input.addEventListener('input', () => historyHint(valueOf(history.input)));
  gallery.input.addEventListener('input', () => galleryHint(valueOf(gallery.input)));

  history.input.addEventListener('change', () => {
    const value = valueOf(history.input);
    if (value === null) return;
    const parsed = parseDays(value);
    if (!parsed.ok) return;
    const days = parsed.value;
    commit(
      showHistory,
      async () => {
        await settings.set('retentionDays', days);
        storedDays = days;
        await limits.pruneHistory(days);
      },
      () => historyText(value),
    );
  });

  gallery.input.addEventListener('change', () => {
    const value = valueOf(gallery.input);
    if (value === null) return;
    const parsed = parseMegabytes(value);
    if (!parsed.ok) return;
    const mb = parsed.value;
    commit(
      showGallery,
      async () => {
        await settings.set('galleryLimitMB', mb);
        await limits.pruneGallery(mb);
      },
      () => galleryText(value),
    );
  });

  Promise.all([settings.get('retentionDays'), settings.get('galleryLimitMB')]).then(
    ([days, mb]) => {
      if (closed) return;
      storedDays = days;
      history.input.value = days === null ? '' : String(days);
      gallery.input.value = mb === null ? '' : String(mb);
      historyHint(history.input.value);
      galleryHint(gallery.input.value);
    },
    (err) => {
      if (closed) return;
      history.hint.textContent = `Could not read settings: ${describeError(err)}`;
      history.hint.classList.add('tdf-warn');
    },
  );

  return () => {
    closed = true;
    for (const fn of undo) fn();
  };
}
