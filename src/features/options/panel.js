// The Settings flyout (UI design 2026-10-27, Flyouts → Settings), in two sections (TDF-0039).
// Chat: Use Chat 2.0 (TDF-0037), Auto-scroll over the engine's #autoScrollID, Collapse server
// history automatically (TDF-0033.3), Chat buffer (last HISTORY_ON, TDF-0033.5, TDF-0084) with
// its Clear chat buffer button, and Hide messages by user (TDF-0010, TDF-0044), a
// Hide / Unhide toggle over the hiddenSenders setting that deletes nothing (TDF-0082), then
// a User options group over the engine's own myOptions checkboxes (TDF-0080). Media and Gallery
// Settings, one flat list: Include my images (TDF-0009.13), Store images offline,
// Compress stored images (TDF-0036), Use media quickview (TDF-0035) and Gallery size limit (MB).
// Every boolean setting is a checkbox drawn as a switch (tdf-opt-switch). Chat buffer (last
// HISTORY_ON) is one too, with no hint: on replays the newest HISTORY_ON lines on reload, and
// turning it off deletes every saved line at once. A hint under the gallery field gives the usage, says the
// oldest over-limit images are purged when the limit is set and on reload (favorites kept), and
// what the typed value would delete; the setting is written, and the deletion runs, only when the
// value is committed (change: Enter or leaving the field). Clear chat buffer asks first, inline.
// The rail gives the flyout body its scrollbar.

import { describeError } from '../../core/errors.js';
import { parseHidden, pickerEntries, toggleHidden } from '../../core/hiddenSenders.js';
import { clearView } from '../../core/events.js';
import { profileUrlFor } from '../../core/forumAvatar.js';
import { chat2Off, setChat2Off } from '../../core/optOut.js';
import { ENGINE_AVATARS_ID } from '../../core/view.js';
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

// The version credits its author (TDF-0045): hovering or focusing it appends the credit, and it
// links to the author's forum profile, by fixed user id, in a new tab.
const AUTHOR = 'SoloBang76';
const AUTHOR_ID = '573314';

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
  // `v<version>` stays visible at rest (a deploy is confirmed by looking); the credit shows on
  // hover or focus. With no engine profileUrl it is a focusable span with role="note", so its
  // aria-label is a permitted name: the credit, no link.
  const profile = profileUrlFor(/** @type {any} */ (win).profileUrl, win.location.href, { userID: AUTHOR_ID });
  /** @type {HTMLElement} */
  let version;
  if (profile !== null) {
    const link = el('a', 'tdf-opt-version');
    link.href = profile;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    version = link;
  } else {
    version = el('span', 'tdf-opt-version');
    version.tabIndex = 0;
    version.setAttribute('role', 'note');
  }
  version.setAttribute('aria-label', `v${VERSION}, by ${AUTHOR}`);
  version.append(el('span', 'tdf-opt-version-num', `v${VERSION}`), el('span', 'tdf-opt-version-by', ` · By ${AUTHOR}`));
  root.append(version, el('div', 'tdf-opt-title', 'Settings'));
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

  root.append(scrollRow);
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

  // Chat buffer (last HISTORY_ON, TDF-0033.5, TDF-0084): a switch over `historyCount`, HISTORY_ON
  // on and 0 off. The label's count derives from the constant, so it cannot disagree with replay.
  // It has no hint of its own (TDF-0084): the hint below it stays empty, and so hidden, unless a
  // read or write fails; the Clear chat buffer button's tooltip carries the state.
  const historyRow = el('label', 'tdf-opt-row');
  const historyBox = el('input', 'tdf-opt-switch');
  historyBox.type = 'checkbox';
  historyRow.append(el('span', '', `Chat buffer (last ${HISTORY_ON})`), historyBox);
  const historyHint = el('div', 'tdf-opt-hint');
  historyHint.setAttribute('aria-live', 'polite');
  root.append(historyRow, historyHint);
  const history = { box: historyBox, hint: historyHint };
  /** Whether Chat buffer is off, once the setting is read or chosen; false until then. */
  let historyOff = false;

  /**
   * How a confirm step is drawn; the step itself (confirmFlow) knows nothing of the layout.
   * @typedef {object} ConfirmView
   * @property {() => void} busy  the trigger was pressed: disable it while counting
   * @property {(question: string) => void} ask  show the question with Confirm and Cancel
   * @property {() => void} running  Confirm was pressed: disable Confirm and Cancel
   * @property {() => void} idle  back to the trigger, everything enabled
   * @property {(message: string, warn: boolean) => void} report  the step's result hint
   */

  /**
   * An action that asks first: the trigger counts what would go (when there is a count) and
   * asks; Confirm runs it once and the hint reports it. Cancel, or closing the flyout, runs
   * nothing. Returns the trigger's, Confirm's and Cancel's handlers for the view to wire.
   * @param {{
   *   count?: () => Promise<number>,
   *   none?: () => string,
   *   question: (n: number) => string,
   *   run: () => Promise<string[]> | string[],
   *   done?: (n: number) => string,
   *   failed?: (err: string) => string,
   *   after?: () => void,
   * }} step
   * @param {ConfirmView} view
   */
  const confirmFlow = (
    {
      count,
      none = () => '',
      question,
      run,
      done = (n) => `Deleted ${plural(n, 'message')}.`,
      failed = (err) => `Could not delete: ${err}`,
      after = () => {},
    },
    view,
  ) => {
    const reset = () => view.idle();
    const start = async () => {
      view.report('', false);
      view.busy();
      let n = 0;
      if (count) {
        try {
          n = await count();
        } catch (err) {
          if (closed) return;
          reset();
          view.report(`Could not check: ${describeError(err)}`, true);
          return;
        }
        if (closed) return;
        if (n === 0) {
          reset();
          view.report(none(), false);
          return;
        }
      }
      view.ask(question(n));
    };
    const confirm = async () => {
      view.running();
      try {
        const ids = await run();
        if (closed) return;
        reset();
        view.report(done(ids.length), false);
      } catch (err) {
        if (closed) return;
        reset();
        view.report(failed(describeError(err)), true);
      }
      after();
    };
    undo.push(reset);
    return { start, confirm, cancel: reset };
  };

  /** @param {HTMLElement} hint @returns {ConfirmView['report']} */
  const reporter = (hint) => (message, warn) => {
    hint.textContent = message;
    hint.classList.toggle('tdf-warn', warn);
  };

  /** @param {string} label */
  const linkButton = (label) => {
    const button = el('button', 'tdf-opt-link', label);
    button.type = 'button';
    return button;
  };

  // Clear chat buffer (TDF-0084): one standalone button under the Chat buffer switch, as before
  // TDF-0081. It swaps for its question and Confirm | Cancel, hint-sized, then returns; the report
  // hint below serves it. Its tooltip follows the switch. The History action (TDF-0010) is still
  // built and wired below but never placed, so it is out of reach until a UI entry returns.
  const clearLine = el('div', 'tdf-opt-clear-line');
  const clearIdle = el('span', 'tdf-opt-clear-idle');
  const bufferButton = el('button', 'tdf-opt-clear', 'Clear chat buffer');
  bufferButton.type = 'button';
  const historyButton = linkButton('History');
  clearIdle.append(bufferButton);
  /** Record whether Chat buffer is off, and say so in the button's tooltip. @param {boolean} off */
  const setHistoryOff = (off) => {
    historyOff = off;
    bufferButton.title = off ? 'Clears the view, no history saved' : 'Clears the view, lines return on reload';
  };
  setHistoryOff(false);
  const clearAsk = el('span', 'tdf-opt-hint tdf-opt-clear-ask');
  clearAsk.hidden = true;
  const clearQuestion = el('span', '');
  const clearYes = linkButton('Confirm');
  const clearNo = linkButton('Cancel');
  clearAsk.append(clearQuestion, el('span', '', ' '), clearYes, el('span', '', ' | '), clearNo);
  clearLine.append(clearIdle, clearAsk);
  const clearHint = el('div', 'tdf-opt-hint tdf-opt-action-hint');
  clearHint.setAttribute('aria-live', 'polite');
  root.append(clearLine, clearHint);

  /** @type {{ confirm: () => void, cancel: () => void } | null} the flow whose question shows */
  let clearActive = null;
  /**
   * Wire one Clear action to the shared line. The pressed link is hidden by the swap, so focus
   * moves to Confirm, and back to the link when the line returns.
   * @param {HTMLButtonElement} trigger
   * @param {Parameters<typeof confirmFlow>[0]} step
   */
  const clearAction = (trigger, step) => {
    // Disabling a focused button drops focus to body while an await runs, so whether the trigger
    // (or Confirm/Cancel) held focus is noted before disabling; body still counts as not moved.
    let triggerFocused = false;
    let askFocused = false;
    const unmoved = () => doc.activeElement === null || doc.activeElement === doc.body;
    const flow = confirmFlow(step, {
      busy: () => {
        triggerFocused = doc.activeElement === trigger;
        bufferButton.disabled = true;
        historyButton.disabled = true;
      },
      ask: (question) => {
        const focused = doc.activeElement === trigger || (triggerFocused && unmoved());
        triggerFocused = false;
        clearActive = flow;
        clearQuestion.textContent = question;
        clearIdle.hidden = true;
        clearAsk.hidden = false;
        if (focused) clearYes.focus();
      },
      running: () => {
        askFocused = clearAsk.contains(doc.activeElement);
        clearYes.disabled = true;
        clearNo.disabled = true;
      },
      idle: () => {
        if (clearActive !== null && clearActive !== flow) return;
        const focused = clearAsk.contains(doc.activeElement) || (askFocused && unmoved());
        triggerFocused = false;
        askFocused = false;
        clearActive = null;
        clearAsk.hidden = true;
        clearIdle.hidden = false;
        bufferButton.disabled = false;
        historyButton.disabled = false;
        clearYes.disabled = false;
        clearNo.disabled = false;
        if (focused) trigger.focus();
      },
      report: reporter(clearHint),
    });
    trigger.addEventListener('click', flow.start);
  };
  clearYes.addEventListener('click', () => clearActive?.confirm());
  clearNo.addEventListener('click', () => clearActive?.cancel());

  // Clear chat buffer: the engine's clrScreen() for its hidden view, then the overlay's own clear through
  // core, so the view's index empties with its rows. Nothing to count and nothing to report unless
  // clrScreen throws; the overlay's view clears either way.
  clearAction(bufferButton, {
    question: () => 'Clear the message view?',
    run: () => {
      const engineClear = /** @type {any} */ (win).clrScreen;
      try {
        if (typeof engineClear === 'function') engineClear();
      } finally {
        clearView();
      }
      return [];
    },
    done: () => '',
    failed: (err) => `Could not clear the view: ${err}`,
  });

  // History: every stored line, in every room. The gallery is not touched. Unplaced (TDF-0084).
  clearAction(historyButton, {
    count: () => limits.countAll(),
    // Off, the lines on screen were never saved, so this cannot remove them (TDF-0054).
    none: () =>
      historyOff
        ? 'Chat buffer is off, so nothing is saved. Clear chat buffer empties the lines on screen.'
        : 'No saved history.',
    question: (n) => `Delete ${plural(n, 'message')}?`,
    run: () => limits.clearHistory(),
    after: () => refreshSenders(),
  });

  // Hide messages by user (TDF-0082): a reversible filter over any sender in stored history,
  // online or not, and every hidden sender, listed even with no saved lines so it can be unhidden.
  // Hide adds the selected sender to the `hiddenSenders` setting and Unhide removes them, at once,
  // with no confirm: nothing is deleted, and the open view follows the setting (bootstrap). The
  // option value is the stored sender, which is what the user index and the set hold; the label is
  // decoded. The small toggle sits in the row after the select (TDF-0081), outside the label,
  // since a button may not sit inside one; its report goes below the row.
  const senderRow = el('div', 'tdf-opt-row tdf-opt-sender');
  const senderLabelEl = el('label', 'tdf-opt-sender-label');
  const sender = el('select', '');
  senderLabelEl.append(el('span', '', 'Hide messages by user'), sender);
  const hideButton = el('button', 'tdf-opt-small', 'Hide');
  hideButton.type = 'button';
  senderRow.append(senderLabelEl, hideButton);
  const hideHint = el('div', 'tdf-opt-hint tdf-opt-action-hint');
  hideHint.setAttribute('aria-live', 'polite');
  /** The hidden senders as last read or written; null until read, and after a failed read. */
  /** @type {readonly string[] | null} */
  let hiddenList = null;
  /** no sender to pick: an empty list, or one that failed to read */
  let unavailable = false;
  /** a toggle's write is running */
  let toggling = false;
  const selectedHidden = () => hiddenList !== null && hiddenList.includes(sender.value);
  const syncSender = () => {
    sender.disabled = unavailable;
    hideButton.textContent = selectedHidden() ? 'Unhide' : 'Hide';
    hideButton.disabled = unavailable || hiddenList === null || toggling;
  };
  sender.addEventListener('change', () => {
    hideHint.textContent = senderWarning;
    hideHint.classList.toggle('tdf-warn', senderWarning !== '');
    syncSender();
  });
  // The set is read again just before the write, so a change made in another tab since the last
  // read is kept; the toggle applies what its label said to that fresh set.
  hideButton.addEventListener('click', async () => {
    const user = sender.value;
    const hiding = !selectedHidden();
    toggling = true;
    syncSender();
    const report = reporter(hideHint);
    try {
      const current = parseHidden(await settings.get('hiddenSenders'));
      const next = current.includes(user) === hiding ? current : toggleHidden(current, user);
      await settings.set('hiddenSenders', next);
      if (closed) return;
      hiddenList = next;
      report(hiding ? `Hid messages from ${senderLabel(user)}.` : `Showing messages from ${senderLabel(user)} again.`, false);
    } catch (err) {
      if (closed) return;
      report(`Could not ${hiding ? 'hide' : 'unhide'}: ${describeError(err)}`, true);
    } finally {
      toggling = false;
    }
    refreshSenders();
  });
  root.append(senderRow, hideHint);

  /**
   * A switch over one of the engine's User Options checkboxes (TDF-0080). The engine checkbox is
   * the source: read when the flyout opens and followed on its change events while open, set on
   * change, then `updateUserSettings()` refreshes the engine's globals and its `myOptions` cookie
   * together. A bubbling change follows on the engine box so 2.0 listeners (the avatar class,
   * view.js) see it. A missing or throwing `updateUserSettings` reverts both boxes, calls it once
   * more so globals it wrote before throwing match the restored box, and says so; an absent
   * engine box disables the row and says why.
   * The engine's `#userMessStyle` is never touched, so `updateUserSettings` writes it back as it was.
   * @param {string} id
   * @param {string} label
   */
  const engineOption = (id, label) => {
    const row = el('label', 'tdf-opt-row');
    const box = el('input', 'tdf-opt-switch');
    box.type = 'checkbox';
    row.append(el('span', '', label), box);
    const hint = el('div', 'tdf-opt-hint tdf-warn');
    hint.setAttribute('aria-live', 'polite');
    root.append(row, hint);
    const engineBox = doc.getElementById(id);
    if (!(engineBox instanceof win.HTMLInputElement)) {
      box.disabled = true;
      hint.textContent = `Not available: the chat has no #${id}`;
      return;
    }
    box.checked = engineBox.checked;
    box.addEventListener('change', () => {
      hint.textContent = '';
      const was = engineBox.checked;
      engineBox.checked = box.checked;
      const update = /** @type {any} */ (win).updateUserSettings;
      try {
        if (typeof update !== 'function') throw new Error('the chat has no updateUserSettings');
        update();
      } catch (err) {
        engineBox.checked = was;
        box.checked = was;
        // The engine writes its globals before the cookie, so a throw can land after the globals
        // took the new value: one more call, over the restored box, puts them back.
        let resync = '';
        if (typeof update === 'function') {
          try {
            update();
          } catch (again) {
            resync = ` (the chat may still use the new setting: ${describeError(again)})`;
          }
        }
        hint.textContent = `Could not apply: ${describeError(err)}${resync}`;
        return;
      }
      engineBox.dispatchEvent(new win.Event('change', { bubbles: true }));
    });
    const follow = () => {
      box.checked = engineBox.checked;
    };
    engineBox.addEventListener('change', follow);
    undo.push(() => engineBox.removeEventListener('change', follow));
  };

  // The engine's User Options (TDF-0080), in the order its own window shows them. Modern Message
  // Style is deliberately not offered.
  root.append(el('div', 'tdf-opt-subsection', 'User options'));
  engineOption('allowPM', 'Allow private chat');
  engineOption('viewMyCamID', 'Allow webcam access');
  engineOption('entryExitID', 'Play entry/exit sounds');
  engineOption('soundsID', 'Play new message sound');
  engineOption('sfxID', 'Play SFX');
  engineOption(ENGINE_AVATARS_ID, 'Display user avatars');

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

  // Only the latest read fills the list. The hidden set is read beside the senders: unreadable,
  // the senders still list and the toggle is disabled, since a write would replace a set never read.
  let senderSeq = 0;
  let senderWarning = '';
  /** @param {string} text */
  const warnSenders = (text) => {
    senderWarning = text;
    hideHint.textContent = text;
    hideHint.classList.add('tdf-warn');
  };
  const refreshSenders = async () => {
    const mine = ++senderSeq;
    /** @type {Array<{ user: string, count: number }>} */
    let saved;
    /** @type {readonly string[] | null} */
    let read = null;
    /** @type {string} */
    let hiddenFailed = '';
    try {
      [saved, read] = await Promise.all([
        limits.senders(),
        settings.get('hiddenSenders').then(parseHidden, (err) => {
          hiddenFailed = describeError(err);
          return null;
        }),
      ]);
    } catch (err) {
      if (closed || mine !== senderSeq) return;
      warnSenders(`Could not read saved senders: ${describeError(err)}`);
      unavailable = true;
      syncSender();
      return;
    }
    if (closed || mine !== senderSeq) return;
    if (senderWarning && hideHint.textContent === senderWarning) {
      hideHint.textContent = '';
      hideHint.classList.remove('tdf-warn');
    }
    senderWarning = '';
    hiddenList = read;
    if (read === null) warnSenders(`Could not read hidden senders: ${hiddenFailed}`);
    const list = pickerEntries(saved, new Set(read ?? []));
    const keep = sender.value;
    sender.replaceChildren(
      ...list.map(({ user, count, hidden }) => {
        const option = el('option', '', `${senderLabel(user)} (${count}${hidden ? ', hidden' : ''})`);
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

  /** The Chat buffer switch's settled hint: empty, so hidden (TDF-0084). */
  const historyText = async () => ({ text: '' });

  /** @param {string | null} input */
  const galleryText = async (input) => {
    const parsed = input === null ? { ok: /** @type {const} */ (false) } : parseMegabytes(input);
    if (!parsed.ok) return { text: 'Enter 1 MB or more, or leave empty for no limit.', warn: true };
    const usage = await limits.previewGallery(parsed.value);
    const used = `${megabytes(usage.used)} used`;
    const { preview } = usage;
    if (!preview) return { text: `No limit. ${used}.` };
    const removes = preview.count
      ? ` Removes ${plural(preview.count, 'image')} (${megabytes(preview.bytes)}) now.`
      : '';
    return {
      text: `${used}; favorites kept; oldest over-limit purged when set and on reload.${removes}`,
      warn: preview.count > 0,
    };
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

  // Ticking writes HISTORY_ON. Unticking writes 0, then deletes every saved line, announced so the open
  // view and tags follow, as Clear history does. A refused write shows the stored value
  // again. Only the latest toggle reverts or clears, so a quick off-then-on never deletes after
  // it, and an earlier refusal never overrides a later choice.
  let historySeq = 0;
  history.box.addEventListener('change', () => {
    const on = history.box.checked;
    const mine = ++historySeq;
    setHistoryOff(!on);
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
            if (!closed && mine === historySeq) {
              history.box.checked = stored;
              setHistoryOff(!stored);
            }
          }
          throw err;
        }
        if (on || mine !== historySeq) return;
        await limits.clearHistory();
        refreshSenders();
      },
      historyText,
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
      setHistoryOff(count === 0);
      gallery.input.value = mb === null ? '' : String(mb);
      showHistory(historyText);
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
