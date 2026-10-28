// The rail: a column docked over the engine's (hidden) #userContainer box. Its header holds
// the status picker and the chips — the built-in Profile chip, then one per registered
// panel — and below it the always-visible user list. A chip opens its panel as one flyout
// at a time, growing leftward over the message view; Esc, a click outside the rail or the
// same chip closes it.

import { describeError } from '../../core/errors.js';
import { installRailHost, listPanels, onRegistryChange } from './api.js';
import { createEngine } from './engine.js';
import { renderIcon } from './icons.js';
import { createProfileChip } from './profileChip.js';
import { createDockedList, createUserStore } from './userList.js';

const MAX_ERRORS = 20;

/**
 * @param {{ doc: Document, win: Window, host: HTMLElement, target: HTMLElement }} deps
 *   host is #tdf-chat, so the rail inherits its theme tokens; target is #userContainer,
 *   whose engine-sized box the rail covers.
 */
export function mountRail({ doc, win, host, target }) {
  const root = doc.createElement('div');
  root.id = 'tdf-rail';
  const header = doc.createElement('div');
  header.className = 'tdf-rail-header';
  const status = doc.createElement('div');
  status.className = 'tdf-rail-status-slot';
  // Built-in chips come first, then the registered panels' chips; both wrap as one row.
  const lead = doc.createElement('div');
  lead.className = 'tdf-rail-chips';
  const chips = doc.createElement('div');
  chips.className = 'tdf-rail-chips';
  header.append(status, lead, chips);
  const errors = doc.createElement('div');
  errors.className = 'tdf-rail-error';
  errors.setAttribute('role', 'status');
  errors.title = 'Click to dismiss';
  errors.hidden = true;
  errors.addEventListener('click', () => {
    errors.replaceChildren();
    errors.hidden = true;
  });
  const list = doc.createElement('div');
  list.className = 'tdf-rail-docked';
  const flyout = doc.createElement('div');
  flyout.className = 'tdf-rail-flyout';
  flyout.hidden = true;
  root.append(header, errors, list, flyout);
  host.appendChild(root);

  // #tdf-rail is position:fixed, so the viewport rect is the one to copy (B1).
  let placed = '';
  const place = () => {
    const { top, left, width, height } = target.getBoundingClientRect();
    const next = `${top},${left},${width},${height}`;
    if (next === placed) return;
    placed = next;
    root.style.top = `${top}px`;
    root.style.left = `${left}px`;
    root.style.width = `${width}px`;
    root.style.height = `${height}px`;
  };
  place();
  // Scroll (capture) and resize fire far more often than frames; read the rect once per frame.
  /** @type {number | null} */
  let frame = null;
  const track = () => {
    if (frame !== null) return;
    frame = win.requestAnimationFrame(() => {
      frame = null;
      place();
    });
  };
  const resizeObserver = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(track) : null;
  resizeObserver?.observe(target);
  win.addEventListener('resize', track);
  win.addEventListener('scroll', track, true);

  /**
   * Show a failure in the rail itself, with its cause; every failure is kept until dismissed.
   * A repeat of one already shown bumps its count, and only the latest MAX_ERRORS are kept,
   * so a persistent failure cannot grow the box without bound.
   * @param {unknown} err
   */
  function report(err) {
    const message = `Rail: ${describeError(err)}`;
    const seen = [...errors.children].find((l) => /** @type {HTMLElement} */ (l).dataset.message === message);
    const line = /** @type {HTMLElement} */ (seen ?? doc.createElement('div'));
    const count = Number(line.dataset.count ?? 0) + 1;
    line.dataset.message = message;
    line.dataset.count = String(count);
    line.textContent = count > 1 ? `${message} (×${count})` : message;
    errors.appendChild(line);
    while (errors.children.length > MAX_ERRORS) errors.firstElementChild?.remove();
    errors.hidden = false;
  }

  /** @type {{ panel: import('./api.js').RailPanel, arg: unknown, cleanup: import('./api.js').Cleanup } | null} */
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
    for (const b of chips.querySelectorAll('.tdf-rail-chip')) b.setAttribute('aria-expanded', 'false');
  }

  /**
   * @param {import('./api.js').RailPanel} panel
   * @param {unknown} [arg]
   */
  function show(panel, arg) {
    close();
    const title = doc.createElement('div');
    title.className = 'tdf-rail-title';
    title.textContent = panel.title;
    const body = doc.createElement('div');
    body.className = 'tdf-rail-body';
    flyout.append(title, body);
    flyout.hidden = false;
    open = { panel, arg, cleanup: undefined };
    open.cleanup = guarded(() => panel.render(body, arg));
    for (const b of chips.querySelectorAll('.tdf-rail-chip')) {
      if (/** @type {HTMLElement} */ (b).dataset.panel === panel.id) b.setAttribute('aria-expanded', 'true');
    }
  }

  function renderChips() {
    for (const fn of slotCleanups) guarded(fn);
    slotCleanups = [];
    chips.replaceChildren();
    const panels = listPanels();
    for (const panel of panels) guarded(() => renderChip(panel));
    // An open panel that was unregistered closes; one replaced under its id re-opens.
    if (open && !panels.includes(open.panel)) {
      const replacement = panels.find((p) => p.id === open?.panel.id);
      if (replacement) show(replacement, open.arg);
      else close();
    }
  }

  /** @param {import('./api.js').RailPanel} panel */
  function renderChip(panel) {
    const chip = doc.createElement('button');
    chip.type = 'button';
    chip.className = 'tdf-rail-chip';
    chip.dataset.panel = panel.id;
    chip.title = panel.title;
    chip.setAttribute('aria-label', panel.title);
    chip.setAttribute('aria-expanded', String(open?.panel === panel));
    const icon = doc.createElement('span');
    icon.className = 'tdf-rail-icon';
    renderIcon(icon, panel.icon);
    chip.appendChild(icon);
    chip.addEventListener('click', () => {
      if (open?.panel === panel) close();
      else show(panel);
    });
    if (panel.renderRailSlot) {
      const slot = doc.createElement('span');
      slot.className = 'tdf-rail-slot';
      chip.appendChild(slot);
      const render = panel.renderRailSlot;
      const cleanup = guarded(() => render(slot));
      if (typeof cleanup === 'function') slotCleanups.push(cleanup);
    }
    chips.appendChild(chip);
  }

  /** @param {KeyboardEvent} event */
  const onKey = (event) => {
    if (event.key === 'Escape' && open) close();
  };
  /** @param {MouseEvent} event */
  const onPointer = (event) => {
    const node = /** @type {Node | null} */ (event.target);
    if (open && node && !root.contains(node)) close();
  };
  doc.addEventListener('keydown', onKey);
  doc.addEventListener('mousedown', onPointer);
  const unsubscribe = onRegistryChange(renderChips, report);
  const uninstall = installRailHost({ open: show, report });
  renderChips();

  return {
    report,
    /** Where the docked list and the built-in chips render. */
    slots: { status, list, lead },
    /**
     * Report a failure that leaves the rail without its user list, and stop hiding the
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
      uninstall();
      unsubscribe();
      resizeObserver?.disconnect();
      if (frame !== null) win.cancelAnimationFrame(frame);
      win.removeEventListener('resize', track);
      win.removeEventListener('scroll', track, true);
      doc.removeEventListener('keydown', onKey);
      doc.removeEventListener('mousedown', onPointer);
      root.remove();
    },
  };
}

/**
 * Mount the rail, its docked list and the list observer once the message view's #tdf-chat
 * exists, so the rail never mounts when the overlay did not start. If #tdf-chat is later
 * removed (the bootstrap undoing a failed start), the rail tears itself down.
 * @param {{ doc: Document, win: Window, css: string }} deps
 * @returns {boolean} false when this page has no user list, or another copy of the script
 *   already started the rail
 */
export function startRail({ doc, win, css }) {
  const w = /** @type {any} */ (win);
  // Only the first copy of the script (userscript plus site include) starts the rail, so the
  // registry it reads is the one that copy's other slices register into. The flag is under
  // the __tdfChat2 prefix build.mjs's second-copy check sets.
  if (w.__tdfChat2Rail) return false;
  const userContainer = doc.getElementById('userContainer');
  if (!userContainer) return false;
  w.__tdfChat2Rail = true;

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
    /** @type {Array<() => void>} undone in reverse */
    const undo = [];
    teardown = () => {
      for (const fn of undo.reverse()) fn();
      teardown = null;
    };
    /** @type {ReturnType<typeof mountRail> | null} */
    let rail = null;
    try {
      rail = mountRail({ doc, win, host, target: userContainer });
      const mounted = rail;
      undo.push(() => mounted.destroy());
      const engine = createEngine(win, doc);
      const store = createUserStore(win, userContainer, rail.report);
      undo.push(() => store.disconnect());
      const deps = { doc, engine, store, onError: rail.report };
      const profile = createProfileChip(deps);
      rail.slots.lead.appendChild(profile.el);
      undo.push(profile.destroy);
      undo.push(createDockedList(deps)({ status: rail.slots.status, list: rail.slots.list }));
    } catch (err) {
      if (rail) rail.fail(err);
      else {
        // A rail that broke while mounting: keep the engine's panel showing (rail.css).
        const half = doc.getElementById('tdf-rail');
        half?.classList.add('tdf-rail-failed');
        undo.push(() => half?.remove());
        console.error('Rail:', err);
      }
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
