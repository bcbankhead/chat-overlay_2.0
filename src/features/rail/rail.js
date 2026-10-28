// The right-edge rail: an icon column with one button per registered panel, each opening
// one flyout at a time. Esc or a click outside the rail closes the flyout.

import { describeError } from '../../core/errors.js';
import { listPanels, onRegistryChange, registerRailPanel } from './api.js';
import { createEngine } from './engine.js';
import { createUserStore, createUsersPanel } from './userList.js';

/**
 * @param {{ doc: Document, host: HTMLElement }} deps
 *   host is #tdf-chat, so the rail inherits its theme tokens.
 */
export function mountRail({ doc, host }) {
  const root = doc.createElement('div');
  root.id = 'tdf-rail';
  const column = doc.createElement('div');
  column.className = 'tdf-rail-column';
  const flyout = doc.createElement('div');
  flyout.className = 'tdf-rail-flyout';
  flyout.hidden = true;
  const errors = doc.createElement('div');
  errors.className = 'tdf-rail-error';
  errors.setAttribute('role', 'status');
  errors.title = 'Click to dismiss';
  errors.hidden = true;
  errors.addEventListener('click', () => {
    errors.replaceChildren();
    errors.hidden = true;
  });
  const side = doc.createElement('div');
  side.className = 'tdf-rail-side';
  side.append(errors, flyout);
  root.append(side, column);
  host.appendChild(root);

  /**
   * Show a failure in the rail itself, with its cause; every failure is kept until dismissed.
   * @param {unknown} err
   */
  function report(err) {
    const line = doc.createElement('div');
    line.textContent = `Rail: ${describeError(err)}`;
    errors.appendChild(line);
    errors.hidden = false;
  }

  /** @type {{ panel: import('./api.js').RailPanel, cleanup: import('./api.js').Cleanup } | null} */
  let open = null;
  /** @type {Array<() => void>} */
  let slotCleanups = [];

  /** @param {() => import('./api.js').Cleanup} fn */
  function guarded(fn) {
    try {
      return fn();
    } catch (err) {
      report(err);
      return undefined;
    }
  }

  function close() {
    if (!open) return;
    const { cleanup } = open;
    open = null;
    if (typeof cleanup === 'function') guarded(cleanup);
    flyout.replaceChildren();
    flyout.hidden = true;
    for (const b of column.querySelectorAll('.tdf-rail-button')) b.setAttribute('aria-expanded', 'false');
  }

  /** @param {import('./api.js').RailPanel} panel */
  function show(panel) {
    close();
    const title = doc.createElement('div');
    title.className = 'tdf-rail-title';
    title.textContent = panel.title;
    const body = doc.createElement('div');
    body.className = 'tdf-rail-body';
    flyout.append(title, body);
    flyout.hidden = false;
    open = { panel, cleanup: undefined };
    open.cleanup = guarded(() => panel.render(body));
    for (const b of column.querySelectorAll('.tdf-rail-button')) {
      if (/** @type {HTMLElement} */ (b).dataset.panel === panel.id) b.setAttribute('aria-expanded', 'true');
    }
  }

  function renderColumn() {
    for (const fn of slotCleanups) guarded(fn);
    slotCleanups = [];
    column.replaceChildren();
    const panels = listPanels();
    for (const panel of panels) {
      const item = doc.createElement('div');
      item.className = 'tdf-rail-item';
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'tdf-rail-button';
      button.dataset.panel = panel.id;
      button.title = panel.title;
      button.setAttribute('aria-label', panel.title);
      button.setAttribute('aria-expanded', String(open?.panel === panel));
      button.textContent = panel.icon;
      button.addEventListener('click', () => {
        if (open?.panel === panel) close();
        else show(panel);
      });
      item.appendChild(button);
      if (panel.renderRailSlot) {
        const slot = doc.createElement('div');
        slot.className = 'tdf-rail-slot';
        item.appendChild(slot);
        const render = panel.renderRailSlot;
        const cleanup = guarded(() => render(slot));
        if (typeof cleanup === 'function') slotCleanups.push(cleanup);
      }
      column.appendChild(item);
    }
    // An open panel that was unregistered closes; one replaced under its id re-opens.
    if (open && !panels.includes(open.panel)) {
      const replacement = panels.find((p) => p.id === open?.panel.id);
      if (replacement) show(replacement);
      else close();
    }
  }

  /** @param {KeyboardEvent} event */
  const onKey = (event) => {
    if (event.key === 'Escape' && open) close();
  };
  /** @param {MouseEvent} event */
  const onPointer = (event) => {
    const target = /** @type {Node | null} */ (event.target);
    if (open && target && !root.contains(target)) close();
  };
  doc.addEventListener('keydown', onKey);
  doc.addEventListener('mousedown', onPointer);
  const unsubscribe = onRegistryChange(renderColumn, report);
  renderColumn();

  return {
    report,
    /**
     * Report a failure that leaves the rail without its Users panel, and stop hiding the
     * engine's own panel (rail.css), so the user list is never lost.
     * @param {unknown} err
     */
    fail(err) {
      report(err);
      root.classList.add('tdf-rail-failed');
    },
    /** Remove the rail and everything it attached. */
    destroy() {
      close();
      for (const fn of slotCleanups) guarded(fn);
      slotCleanups = [];
      unsubscribe();
      doc.removeEventListener('keydown', onKey);
      doc.removeEventListener('mousedown', onPointer);
      root.remove();
    },
  };
}

/**
 * Mount the rail, its Users panel and the list observer once the message view's #tdf-chat
 * exists, so the rail never mounts when the overlay did not start. If #tdf-chat is later
 * removed (the bootstrap undoing a failed start), the rail tears itself down.
 * @param {{ doc: Document, win: Window, css: string }} deps
 * @returns {boolean} false when this page has no user list, or another copy of the script
 *   already started the rail
 */
export function startRail({ doc, win, css }) {
  const w = /** @type {any} */ (win);
  // Only the first copy of the script (userscript plus site include) starts the rail, so the
  // registry it reads is the one that copy's other slices register into.
  if (w.__tdfRailStarted) return false;
  const userContainer = doc.getElementById('userContainer');
  if (!userContainer) return false;
  w.__tdfRailStarted = true;

  /** @type {(() => void) | null} */
  let teardown = null;

  const mount = () => {
    const host = doc.getElementById('tdf-chat');
    if (!host || doc.getElementById('tdf-rail')) return;
    if (!doc.getElementById('tdf-rail-style')) {
      const style = doc.createElement('style');
      style.id = 'tdf-rail-style';
      style.textContent = css;
      doc.head.appendChild(style);
    }
    const rail = mountRail({ doc, host });
    /** @type {Array<() => void>} undone in reverse */
    const undo = [() => rail.destroy()];
    teardown = () => {
      for (const fn of undo.reverse()) fn();
      teardown = null;
    };
    try {
      const engine = createEngine(win, doc);
      const store = createUserStore(win, userContainer, rail.report);
      undo.push(() => store.disconnect());
      undo.push(registerRailPanel(createUsersPanel({ doc, engine, store, onError: rail.report })));
    } catch (err) {
      rail.fail(err);
    }
  };

  mount();
  const observer = new win.MutationObserver(() => {
    if (teardown && !doc.getElementById('tdf-chat')) teardown();
    else if (!teardown) mount();
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  return true;
}
