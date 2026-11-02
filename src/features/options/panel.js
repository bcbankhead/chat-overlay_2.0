// The Settings flyout (UI design 2026-10-27, Flyouts → Settings), in two sections (TDF-0039).
// Chat: Use Chat 2.0 (TDF-0037), Auto-scroll over the engine's #autoScrollID, Clear chat buffer,
// Collapse server history automatically (TDF-0033.3), Chat history (last 100, TDF-0033.5), Clear
// history now and Hide messages by user (TDF-0010, TDF-0044). Media and Gallery Settings, one
// flat list: Include my images (TDF-0009.13), Store images offline, Compress stored images
// (TDF-0036), Use media quickview (TDF-0035) and Gallery size limit (MB). Every boolean setting
// is a checkbox drawn as a switch (tdf-opt-switch). Chat history (last 100) is one too: on
// replays the newest 100 lines on reload, and turning it off deletes every saved line at once,
// its hint saying how many beforehand. A hint under the gallery field says what the typed value
// would delete; the setting is written, and the deletion runs, only when the value is committed
// (change: Enter or leaving the field). The two deletions ask first, inline. The rail gives the
// flyout body its scrollbar.

import { describeError } from '../../core/errors.js';
import { clearView } from '../../core/events.js';
import { chat2Off, setChat2Off } from '../../core/optOut.js';
import { parseHistoryCount } from '../../core/retention.js';
import { HISTORY_ON, MB_BYTES, parseMegabytes, senderLabel } from './selectors.js';

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

// package.json's version, set by build.mjs's esbuild `define`; an unbuilt run (the tests) has none.
/** @type {string} */
const VERSION = typeof __TDF_CHAT_VERSION__ === 'string' ? __TDF_CHAT_VERSION__ : 'dev';

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
  // The version floats right, ahead of the title, so the title keeps its own text and siblings.
  root.append(el('span', 'tdf-opt-version', `v${VERSION}`), el('div', 'tdf-opt-title', 'Settings'));
  const failure = loadFailure();
  if (failure !== null) {
    root.append(el('div', 'tdf-opt-hint tdf-warn', `The storage limits did not run on load: ${failure}`));
  }

  /**
   * A checkbox row over a boolean setting, written on change, appended where it is called. An
   * optional static hint says what the box does; a second hint shows only a failure.
   * @param {'autoCollapseServerHistory' | 'includeMyImages' | 'storeImagesOffline' | 'compressStoredImages' | 'useMediaQuickview'} key
   * @param {string} label
   * @param {string} [about]
   */
  const check = (key, label, about) => {
    const row = el('label', 'tdf-opt-row');
    const box = el('input', 'tdf-opt-switch');
    box.type = 'checkbox';
    row.append(el('span', '', label), box);
    root.append(row);
    if (about !== undefined) root.append(el('div', 'tdf-opt-hint', about));
    const hint = el('div', 'tdf-opt-hint tdf-warn');
    hint.setAttribute('aria-live', 'polite');
    root.append(hint);
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

  root.append(el('div', 'tdf-opt-section tdf-opt-first', 'Chat'));

  // Use Chat 2.0: unchecking records the choice (optOut.js, TDF-0037) and reloads into the
  // original chat, asking nothing; its Switch to Chat 2.0 link turns it back on. A write the
  // browser refuses says so here and does not reload.
  const chat2Row = el('label', 'tdf-opt-row');
  const chat2 = el('input', 'tdf-opt-switch tdf-opt-chat2');
  chat2.type = 'checkbox';
  chat2.checked = !chat2Off(win);
  chat2Row.append(el('span', '', 'Use Chat 2.0'), chat2);
  const chat2Hint = el('div', 'tdf-opt-hint tdf-warn');
  chat2Hint.setAttribute('aria-live', 'polite');
  root.append(chat2Row, chat2Hint);
  chat2.addEventListener('change', () => {
    if (chat2.checked) return;
    chat2Hint.textContent = '';
    try {
      setChat2Off(win, true);
    } catch (err) {
      chat2.checked = true;
      chat2Hint.textContent = `Could not apply: ${describeError(err)}`;
      return;
    }
    win.location.reload();
  });

  // Auto-scroll: the engine's own checkbox, both ways; the engine reads it on every line.
  const scrollRow = el('label', 'tdf-opt-row');
  const scroll = el('input', 'tdf-opt-switch tdf-opt-autoscroll');
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
  );
  // Collapse server history automatically (TDF-0033.3): core follows the setting live.
  check('autoCollapseServerHistory', 'Collapse server history automatically', 'Server-history blocks arrive collapsed.');

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

  // Chat history (last 100, TDF-0033.5): a switch over `historyCount`, 100 on and 0 off.
  const historyRow = el('label', 'tdf-opt-row');
  const historyBox = el('input', 'tdf-opt-switch');
  historyBox.type = 'checkbox';
  historyRow.append(el('span', '', 'Chat history (last 100)'), historyBox);
  const historyHint = el('div', 'tdf-opt-hint');
  historyHint.setAttribute('aria-live', 'polite');
  root.append(historyRow, historyHint);
  const history = { box: historyBox, hint: historyHint };

  /**
   * A button that asks before it deletes: the first click counts what would go and shows that
   * with Confirm and Cancel; Confirm deletes once and the hint reports it. Cancel, or closing
   * the flyout, deletes nothing.
   * @param {string} label
   * @param {{
   *   count: () => Promise<number>,
   *   none: () => string,
   *   question: (n: number) => string,
   *   run: () => Promise<string[]>,
   *   done?: (n: number) => string,
   *   failed?: (err: string) => string,
   *   after?: () => void,
   *   lock?: (on: boolean) => void,
   * }} step
   */
  const confirmStep = (
    label,
    {
      count,
      none,
      question,
      run,
      done = (n) => `Deleted ${plural(n, 'message')}.`,
      failed = (err) => `Could not delete: ${err}`,
      after = () => {},
      lock = () => {},
    },
  ) => {
    const button = el('button', 'tdf-opt-clear', label);
    button.type = 'button';
    const ask = el('div', 'tdf-opt-confirm');
    ask.hidden = true;
    const text = el('span', '');
    const yes = el('button', 'tdf-opt-confirm-yes', 'Confirm');
    yes.type = 'button';
    const no = el('button', '', 'Cancel');
    no.type = 'button';
    ask.append(text, yes, no);
    const hint = el('div', 'tdf-opt-hint tdf-opt-action-hint');
    hint.setAttribute('aria-live', 'polite');

    const reset = () => {
      ask.hidden = true;
      button.hidden = false;
      button.disabled = false;
      yes.disabled = false;
      no.disabled = false;
      lock(false);
    };
    /** @param {string} message @param {boolean} [warn] */
    const report = (message, warn = false) => {
      hint.textContent = message;
      hint.classList.toggle('tdf-warn', warn);
    };

    button.addEventListener('click', async () => {
      report('');
      button.disabled = true;
      lock(true);
      let n;
      try {
        n = await count();
      } catch (err) {
        if (closed) return;
        reset();
        report(`Could not check: ${describeError(err)}`, true);
        return;
      }
      if (closed) return;
      if (n === 0) {
        reset();
        report(none());
        return;
      }
      text.textContent = question(n);
      button.hidden = true;
      ask.hidden = false;
    });
    no.addEventListener('click', reset);
    yes.addEventListener('click', async () => {
      yes.disabled = true;
      no.disabled = true;
      try {
        const ids = await run();
        if (closed) return;
        reset();
        report(done(ids.length));
      } catch (err) {
        if (closed) return;
        reset();
        report(failed(describeError(err)), true);
      }
      after();
    });
    undo.push(reset);
    return { button, ask, hint };
  };

  // Clear history now: every stored line, in every room. The gallery is not touched.
  const clearHistory = confirmStep('Clear history now', {
    count: () => limits.countAll(),
    none: () => 'No saved history.',
    question: (n) => `Delete ${plural(n, 'message')}?`,
    run: () => limits.clearHistory(),
    after: () => refreshSenders(),
  });
  root.append(clearHistory.button, clearHistory.ask, clearHistory.hint);

  // Hide messages by user: any sender in stored history, online or not. It removes their lines
  // from local history only, so it says hide: the chat server may replay those messages. The
  // option value is the stored sender, which is what the user index holds; the label is decoded.
  const senderRow = el('label', 'tdf-opt-row tdf-opt-sender');
  const sender = el('select', '');
  senderRow.append(el('span', '', 'Hide messages by user'), sender);
  // The sender asked about, fixed for that question; the picker is locked while it is open.
  let asked = '';
  let locked = false;
  /** no sender to pick: an empty list, or one that failed to read */
  let unavailable = false;
  const syncSender = () => {
    sender.disabled = locked || unavailable;
    if (!locked) byUser.button.disabled = unavailable;
  };
  const byUser = confirmStep('Hide', {
    count: () => {
      asked = sender.value;
      return limits.countByUser(asked);
    },
    none: () => `No saved messages from ${senderLabel(asked)} to hide.`,
    question: (n) => `Hide ${plural(n, 'message')} from ${senderLabel(asked)}?`,
    run: () => limits.deleteByUser(asked),
    done: (n) => `Hid ${plural(n, 'message')}.`,
    failed: (err) => `Could not hide: ${err}`,
    after: () => refreshSenders(),
    lock: (on) => {
      locked = on;
      syncSender();
    },
  });
  root.append(senderRow, byUser.button, byUser.ask, byUser.hint);

  root.append(el('div', 'tdf-opt-section', 'Media and Gallery Settings'));

  // Include my images: whether capture keeps the user's own shares, from the next share.
  check('includeMyImages', 'Include my images');
  // Store images offline: whether capture also keeps each new image's full copy, not only its
  // thumbnail, from the next share.
  check('storeImagesOffline', 'Store images offline');
  // Compress stored images: each stored original is re-encoded as a smaller JPEG at its own
  // dimensions, from the next share, and those already stored in the background (TDF-0036).
  check('compressStoredImages', 'Compress stored images');
  // Use media quickview: a shared image or gallery tile opens in the in-chat popover; off opens
  // a new tab. Read at each click, so it applies without a reload (TDF-0035).
  check('useMediaQuickview', 'Use media quickview');

  const gallery = field('Gallery size limit (MB)', 'No limit');
  gallery.input.min = '1';

  // Only the latest read fills the list.
  let senderSeq = 0;
  let senderWarning = '';
  const refreshSenders = async () => {
    const mine = ++senderSeq;
    /** @type {Array<{ user: string, count: number }>} */
    let list;
    try {
      list = await limits.senders();
    } catch (err) {
      if (closed || mine !== senderSeq) return;
      senderWarning = `Could not read saved senders: ${describeError(err)}`;
      byUser.hint.textContent = senderWarning;
      byUser.hint.classList.add('tdf-warn');
      unavailable = true;
      syncSender();
      return;
    }
    if (closed || mine !== senderSeq) return;
    if (senderWarning && byUser.hint.textContent === senderWarning) {
      byUser.hint.textContent = '';
      byUser.hint.classList.remove('tdf-warn');
    }
    senderWarning = '';
    const keep = sender.value;
    sender.replaceChildren(
      ...list.map(({ user, count }) => {
        const option = el('option', '', `${senderLabel(user)} (${count})`);
        option.value = user;
        return option;
      }),
    );
    // The kept sender while still listed, else the first: chosen explicitly, not by default.
    const chosen = list.find(({ user }) => user === keep) ?? list[0];
    if (chosen) sender.value = chosen.user;
    const empty = list.length === 0;
    if (empty) sender.append(el('option', '', 'No saved history'));
    unavailable = empty;
    syncSender();
  };
  refreshSenders();

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

  // A number input the browser cannot parse ('-', 'e') reports '' — read as invalid, not empty.
  /** @param {HTMLInputElement} input */
  const valueOf = (input) => (input.validity?.badInput ? null : input.value);

  /**
   * What the Chat history switch does in its state: on, how many saved lines turning it off
   * would delete.
   * @param {boolean} on
   */
  const historyText = async (on) => {
    if (!on) return { text: 'No chat history is kept or replayed.' };
    const base = `Replays the newest ${HISTORY_ON} lines on reload.`;
    const n = await limits.countAll();
    return { text: base + (n ? ` Turning it off deletes ${plural(n, 'saved line')}.` : '') };
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

  gallery.input.addEventListener('input', () => galleryHint(valueOf(gallery.input)));

  // Ticking writes 100. Unticking writes 0, then deletes every saved line, announced so the open
  // view and tags follow, as Clear history now does. A refused write shows the stored value
  // again. Only the latest toggle reverts or clears, so a quick off-then-on never deletes after
  // it, and an earlier refusal never overrides a later choice.
  let historySeq = 0;
  history.box.addEventListener('change', () => {
    const on = history.box.checked;
    const mine = ++historySeq;
    commit(
      showHistory,
      async () => {
        try {
          await settings.set('historyCount', on ? HISTORY_ON : 0);
        } catch (err) {
          if (mine === historySeq) {
            const stored = await settings.get('historyCount').then(
              (value) => parseHistoryCount(value) !== 0,
              () => !on,
            );
            if (!closed && mine === historySeq) history.box.checked = stored;
          }
          throw err;
        }
        if (on || mine !== historySeq) return;
        await limits.clearHistory();
        refreshSenders();
      },
      () => historyText(on),
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

  Promise.all([settings.get('historyCount'), settings.get('galleryLimitMB')]).then(
    ([count, mb]) => {
      if (closed) return;
      history.box.checked = count !== 0;
      gallery.input.value = mb === null ? '' : String(mb);
      showHistory(() => historyText(count !== 0));
      galleryHint(gallery.input.value);
    },
    (err) => {
      if (closed) return;
      // The two fields sit in different sections (TDF-0044), so each carries the warning.
      for (const field of [history, gallery]) {
        field.hint.textContent = `Could not read settings: ${describeError(err)}`;
        field.hint.classList.add('tdf-warn');
      }
    },
  );

  return () => {
    closed = true;
    for (const fn of undo) fn();
  };
}
