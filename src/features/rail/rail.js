// The sidebar (UI design 2026-10-27): mounted on <body> over the engine's (hidden)
// #userContainer box, raised into the room-creation row above it. From the top: the icon
// row — registered panels, the theme toggle, then the end-aligned panels (the Settings gear)
// at the right; the current room; the other rooms; Logout. A panel icon opens its flyout,
// one at a time, growing leftward from the sidebar's left edge; Esc closes it, and the
// first press outside it only closes it.

import { describeError } from '../../core/errors.js';
import { installRailHost, listPanels, onRegistryChange } from './api.js';
import { createEngine } from './engine.js';
import { ICONS, renderIcon } from './icons.js';
import { createNameMenu } from './nameMenu.js';
import { createRoomList, createUserStore } from './userList.js';

const MAX_ERRORS = 20;
/** The flyout's slide (rail.css); `settled` follows it, or this, whichever comes first. */
const SLIDE_MS = 220;

/**
 * The parts of src/core/shell.js the rail uses; injected so tests can stub them.
 * @typedef {object} RailShell
 * @property {() => Promise<void>} toggleTheme
 * @property {(fn: (theme: 'light' | 'dark') => void) => () => void} onThemeChange
 * @property {() => 'light' | 'dark' | null} currentTheme
 * @property {(el: HTMLElement) => () => void} attachScrollbar
 */

/**
 * @param {{ doc: Document, win: Window, target: HTMLElement, raise?: number, shell: RailShell }} deps
 *   target is #userContainer, whose engine-sized box the sidebar covers; raise is how far
 *   above its top the sidebar starts (the hidden room-creation row, C7)
 */
export function mountRail({ doc, win, target, raise = 0, shell }) {
  const root = doc.createElement('div');
  root.id = 'tdf-rail';
  const icons = doc.createElement('div');
  icons.className = 'tdf-rail-icons';
  const startIcons = doc.createElement('div');
  startIcons.className = 'tdf-rail-icon-group';
  const theme = doc.createElement('button');
  theme.type = 'button';
  theme.className = 'tdf-rail-icon-btn tdf-rail-theme';
  const endIcons = doc.createElement('div');
  endIcons.className = 'tdf-rail-icon-group tdf-rail-end';
  icons.append(startIcons, theme, endIcons);
  const errors = doc.createElement('div');
  errors.className = 'tdf-rail-error';
  errors.setAttribute('role', 'status');
  errors.title = 'Click to dismiss';
  errors.hidden = true;
  errors.addEventListener('click', () => {
    errors.replaceChildren();
    errors.hidden = true;
  });
  const current = doc.createElement('div');
  current.className = 'tdf-rail-current';
  const others = doc.createElement('div');
  others.className = 'tdf-rail-others';
  const logout = doc.createElement('button');
  logout.type = 'button';
  logout.className = 'tdf-rail-logout';
  const logoutIcon = doc.createElement('span');
  logoutIcon.className = 'tdf-rail-glyph';
  renderIcon(logoutIcon, ICONS.logout);
  logout.append(logoutIcon, 'Logout');
  const flyout = doc.createElement('div');
  flyout.className = 'tdf-rail-flyout';
  flyout.setAttribute('role', 'dialog');
  root.append(icons, errors, current, others, logout, flyout);
  doc.body.appendChild(root);

  // #tdf-rail is position:fixed, so the viewport rect is the one to copy (B1).
  let placed = '';
  const place = () => {
    const { top, left, width, height } = target.getBoundingClientRect();
    const next = `${top},${left},${width},${height}`;
    if (next === placed) return;
    placed = next;
    // A failed rail re-shows the engine's room row (rail.css), so it no longer covers it.
    const up = root.classList.contains('tdf-rail-failed') ? 0 : raise;
    root.style.top = `${top - up}px`;
    root.style.left = `${left}px`;
    root.style.width = `${width}px`;
    root.style.height = `${height + up}px`;
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

  /** @param {() => import('./api.js').Cleanup} fn */
  function guarded(fn) {
    try {
      return fn();
    } catch (err) {
      report(err);
      return undefined;
    }
  }

  // Theme toggle: a moon in light, a sun in dark. Before the shell has a theme, the page's
  // own preference stands in (C3).
  const prefersDark = () => Boolean(win.matchMedia?.('(prefers-color-scheme: dark)').matches);
  /** @param {'light' | 'dark'} resolved */
  const showTheme = (resolved) => {
    const dark = resolved === 'dark';
    renderIcon(theme, dark ? ICONS.sun : ICONS.moon);
    theme.title = dark ? 'Switch to light' : 'Switch to dark';
    theme.setAttribute('aria-label', theme.title);
  };
  showTheme(shell.currentTheme() ?? (prefersDark() ? 'dark' : 'light'));
  const offTheme = shell.onThemeChange(showTheme);
  theme.addEventListener('click', () => {
    guarded(() => {
      shell.toggleTheme().catch(report);
    });
  });

  // Logout presses the engine's own (hidden) Logout, so logout('0') runs as before (C6).
  logout.addEventListener('click', () => {
    const original = doc.getElementById('optionsLogout');
    if (original) original.click();
    else report(new Error('the chat engine has no Logout control'));
  });

  /** @type {{ panel: import('./api.js').RailPanel, arg: unknown, cleanup: import('./api.js').Cleanup, detach: () => void } | null} */
  let open = null;
  /** @type {Array<() => void>} */
  let slotCleanups = [];
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let settleTimer;

  const reducedMotion = () => Boolean(win.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const iconButtons = () => /** @type {HTMLElement[]} */ ([...icons.querySelectorAll('.tdf-rail-icon-btn[data-panel]')]);

  function close() {
    if (!open) return;
    const { cleanup, detach } = open;
    open = null;
    if (typeof cleanup === 'function') guarded(cleanup);
    detach();
    clearTimeout(settleTimer);
    flyout.classList.remove('tdf-open', 'tdf-settled');
    flyout.removeAttribute('aria-label');
    flyout.replaceChildren();
    for (const b of iconButtons()) b.setAttribute('aria-expanded', 'false');
  }

  /**
   * @param {import('./api.js').RailPanel} panel
   * @param {unknown} [arg]
   */
  function show(panel, arg) {
    const sliding = !open;
    close();
    const body = doc.createElement('div');
    body.className = 'tdf-rail-body';
    flyout.replaceChildren(body);
    flyout.setAttribute('aria-label', panel.title);
    flyout.classList.add('tdf-open');
    // Contents fade in once the slide ends; switching panels has no slide to wait for.
    const settle = () => {
      clearTimeout(settleTimer);
      if (open?.panel === panel) flyout.classList.add('tdf-settled');
    };
    if (!sliding || reducedMotion()) flyout.classList.add('tdf-settled');
    else settleTimer = setTimeout(settle, SLIDE_MS + 40);
    open = { panel, arg, cleanup: undefined, detach: shell.attachScrollbar(body) };
    open.cleanup = guarded(() => panel.render(body, arg));
    for (const b of iconButtons()) b.setAttribute('aria-expanded', String(b.dataset.panel === panel.id));
  }

  /** @param {TransitionEvent} event */
  const onSlid = (event) => {
    if (event.target === flyout && event.propertyName === 'transform' && open) {
      clearTimeout(settleTimer);
      flyout.classList.add('tdf-settled');
    }
  };
  flyout.addEventListener('transitionend', onSlid);

  function renderIcons() {
    for (const fn of slotCleanups) guarded(fn);
    slotCleanups = [];
    startIcons.replaceChildren();
    endIcons.replaceChildren();
    const panels = listPanels();
    for (const panel of panels) guarded(() => renderPanelIcon(panel));
    // An open panel that was unregistered closes; one replaced under its id re-opens.
    if (open && !panels.includes(open.panel)) {
      const replacement = panels.find((p) => p.id === open?.panel.id);
      if (replacement) show(replacement, open.arg);
      else close();
    }
  }

  /** @param {import('./api.js').RailPanel} panel */
  function renderPanelIcon(panel) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'tdf-rail-icon-btn';
    button.dataset.panel = panel.id;
    button.title = panel.title;
    button.setAttribute('aria-label', panel.title);
    button.setAttribute('aria-expanded', String(open?.panel === panel));
    const glyph = doc.createElement('span');
    glyph.className = 'tdf-rail-glyph';
    renderIcon(glyph, panel.icon);
    button.appendChild(glyph);
    button.addEventListener('click', () => {
      if (open?.panel === panel) close();
      else show(panel);
    });
    if (panel.renderRailSlot) {
      const slot = doc.createElement('span');
      slot.className = 'tdf-rail-slot';
      button.appendChild(slot);
      const render = panel.renderRailSlot;
      const cleanup = guarded(() => render(slot));
      if (typeof cleanup === 'function') slotCleanups.push(cleanup);
    }
    (panel.align === 'end' ? endIcons : startIcons).appendChild(button);
  }

  // The first press outside an open flyout only closes it: the press is cancelled and the
  // click it would make is swallowed, so it never also toggles a room or presses a button
  // underneath. A panel icon keeps its own click, which switches or toggles the flyout.
  let swallowClick = false;
  /** @param {MouseEvent} event */
  const onPress = (event) => {
    const node = /** @type {Node | null} */ (event.target);
    if (!open || !node || flyout.contains(node)) return;
    if (iconButtons().some((b) => b.contains(node))) return;
    close();
    event.preventDefault();
    swallowClick = true;
  };
  /** @param {MouseEvent} event */
  const onClick = (event) => {
    if (!swallowClick) return;
    swallowClick = false;
    event.preventDefault();
    event.stopPropagation();
  };
  // A press that ends without a click (dragged off its target) must not carry the flag over
  // to the next, unrelated click; cleared after the click this release may still make.
  const onRelease = () => {
    if (swallowClick) setTimeout(() => (swallowClick = false), 0);
  };
  /** @param {KeyboardEvent} event */
  const onKey = (event) => {
    if (event.key === 'Escape' && open) close();
  };
  doc.addEventListener('mousedown', onPress, true);
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('mouseup', onRelease, true);
  doc.addEventListener('keydown', onKey);
  const unsubscribe = onRegistryChange(renderIcons, report);
  const uninstall = installRailHost({ open: show, report });
  renderIcons();

  return {
    report,
    /** Where the rooms render. */
    slots: { current, others },
    /** The element the name menu is placed in. */
    root,
    /**
     * Report a failure that leaves the rail without its user list, and stop hiding the
     * engine's own controls (rail.css), so the user list is never lost.
     * @param {unknown} err
     */
    fail(err) {
      report(err);
      root.classList.add('tdf-rail-failed');
      placed = '';
      place();
    },
    /** Remove the rail and everything it attached. */
    destroy() {
      close();
      for (const fn of slotCleanups) guarded(fn);
      slotCleanups = [];
      uninstall();
      unsubscribe();
      offTheme();
      resizeObserver?.disconnect();
      if (frame !== null) win.cancelAnimationFrame(frame);
      win.removeEventListener('resize', track);
      win.removeEventListener('scroll', track, true);
      flyout.removeEventListener('transitionend', onSlid);
      doc.removeEventListener('mousedown', onPress, true);
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('mouseup', onRelease, true);
      doc.removeEventListener('keydown', onKey);
      root.remove();
    },
  };
}

/**
 * How far above #userContainer the sidebar starts: up to #roomIcon's top edge, the row it
 * hides, when that row sits above the list (C7). Read before the rail first mounts, since
 * the hidden row has no box afterwards.
 * @param {Document} doc
 * @param {HTMLElement} target
 */
export function readRaise(doc, target) {
  const row = doc.getElementById('roomIcon');
  if (!row) return 0;
  const edge = row.getBoundingClientRect().top;
  const top = target.getBoundingClientRect().top;
  return edge > 0 && edge < top ? top - edge : 0;
}

/**
 * Mount the sidebar, its rooms and the list observer once the message view's #tdf-chat
 * exists, so the rail never mounts when the overlay did not start. If #tdf-chat is later
 * removed (the bootstrap undoing a failed start), the rail tears itself down.
 * @param {{ doc: Document, win: Window, css: string, shell: RailShell }} deps
 * @returns {boolean} false when this page has no user list, or another copy of the script
 *   already started the rail
 */
export function startRail({ doc, win, css, shell }) {
  const w = /** @type {any} */ (win);
  // Only the first copy of the script (userscript plus site include) starts the rail, so the
  // registry it reads is the one that copy's other slices register into. The flag is under
  // the __tdfChat2 prefix build.mjs's second-copy check sets.
  if (w.__tdfChat2Rail) return false;
  const userContainer = doc.getElementById('userContainer');
  if (!userContainer) return false;
  w.__tdfChat2Rail = true;
  const raise = readRaise(doc, userContainer);

  /** @type {(() => void) | null} */
  let teardown = null;

  const mount = () => {
    if (!doc.getElementById('tdf-chat') || doc.getElementById('tdf-rail')) return;
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
      rail = mountRail({ doc, win, target: userContainer, raise, shell });
      const mounted = rail;
      undo.push(() => mounted.destroy());
      const engine = createEngine(win, doc);
      const menu = createNameMenu({ doc, win, engine, parent: rail.root, onError: rail.report });
      undo.push(menu.destroy);
      const store = createUserStore(win, userContainer, rail.report);
      undo.push(() => store.disconnect());
      const rooms = createRoomList({
        doc,
        engine,
        store,
        attachScrollbar: shell.attachScrollbar,
        onUser: menu.open,
        onError: rail.report,
        avatars: () => w.__tdfChat2Avatars ?? null,
      });
      undo.push(rooms(rail.slots));
    } catch (err) {
      if (rail) rail.fail(err);
      else {
        // A rail that broke while mounting: keep the engine's controls showing (rail.css),
        // drop the raise off their row, and show the cause in its own error box.
        const half = doc.getElementById('tdf-rail');
        if (half) {
          half.classList.add('tdf-rail-failed');
          half.style.top = `${userContainer.getBoundingClientRect().top}px`;
          const box = /** @type {HTMLElement | null} */ (half.querySelector('.tdf-rail-error'));
          if (box) {
            box.textContent = `Rail: ${describeError(err)}`;
            box.hidden = false;
          }
          undo.push(() => half.remove());
        }
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
