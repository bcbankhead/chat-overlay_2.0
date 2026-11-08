// The Gallery flyout (UI design 2026-10-27, Flyouts → Gallery), rendered into the rail's
// flyout body, which already scrolls through shell.attachScrollbar. A sticky header (title,
// `N images · size on disk`, the My Images and favourites filters, the user-filter chip), then a 3-column
// grid of stored 128×128 thumbnails. Opening never fetches a full image. Each tile: trash
// top left, star top right, shown on hover; a favourite keeps its star and its trash is
// disabled. A chip in the lower left shows the record's size on disk, orange once large
// (TDF-0024). A tile click opens the image in a new tab (TDF-0023, reversing A4); a record with
// nothing to open (open.js isUnavailable) is faded and labelled, and its click retries the
// server copy, which makes the tile openable again when it loads.
// Tiles are kept by id across refreshes, so a star or a new capture does not replay the
// fade-in, which gallery.css keys on the rail's `tdf-settled` (set once the flyout's slide ends).
// A refresh reconciles the grid by key and never detaches a tile that stays (TDF-0047):
// detaching every tile emptied the grid mid-redraw, which reset the flyout's scroll to the top
// and dropped focus from the star just clicked.
// With Use media quickview on (TDF-0035), a tile click opens the media popover over the tiles
// shown, in display order; its zoom is the tile's own open, and an unavailable tile still
// retries rather than opening.
// Registered actions sit in a bar at the lower right, opposite the size chip. One whose
// onSelect returns a Promise holds its button busy until it settles, then cools down for its
// cooldownMs (TDF-0038, TDF-0062's Re-post) or shows the failure's reason, retryable at once;
// its state is kept by item id at module scope, so a redraw or a reopened flyout keeps it, and
// a promise settling after close still records it.
// My Images (TDF-0046) shows only records the current user (the `self` dep) sent. It combines
// with favourites, clears the user-filter chip when pressed, is hidden while no user name is
// known, and resets each open, like favourites.
// A tile can be dragged to a new place in the grid (TDF-0060): a mouse or pen past 6 px, a touch
// after a 350 ms hold (an earlier move scrolls the flyout as before). The drop stores one key
// between its visible neighbours (store.move), so a move under a filter leaves hidden tiles where
// they were; the grid's order is order.js's. A press on any button never drags, the click after a
// drag is swallowed, and store refreshes wait for the drop. There is no control that drops every
// manual place at once (TDF-0067): one press would undo a curated order.

import { renderIcon } from '../rail/icons.js';
import { listGalleryItemActions, listGalleryItemDecorations, onGalleryRegistryChange } from './api.js';
import { clearGalleryErrors, listGalleryErrors, onGalleryErrors } from './errors.js';
import { openLightbox } from './lightbox.js';
import { isUnavailable } from './open.js';
import { displayOrder } from './order.js';
import { formatBytes, isLarge, shareUrl } from './shareParse.js';
import { onImagesChange } from './store.js';

const REMOVE_MS = 180;
/** Movement before a mouse or pen press becomes a drag, and that ends a touch hold. */
const DRAG_SLOP_PX = 6;
const TOUCH_HOLD_MS = 350;
/** Distance from the flyout body's edge where a drag scrolls it. */
const EDGE_PX = 40;
const UNAVAILABLE = 'Image unavailable from server';

const ICONS = {
  person:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20.5c0-4.1 3.6-7 8-7s8 2.9 8 7z"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3.2l2.7 5.5 6 .9-4.4 4.2 1 6-5.3-2.8-5.3 2.8 1-6L3.3 9.6l6-.9z"/></svg>',
  trash:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  broken:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 15l6-6M11 6l1-1a4 4 0 0 1 6 6l-1 1M13 18l-1 1a4 4 0 0 1-6-6l1-1"/></svg>',
};

/**
 * What `open(arg)` may pass: the user menu's "View images" filters to one sender.
 * @typedef {{ user?: string, label?: string } | undefined} GalleryArg
 */

/**
 * @typedef {object} GalleryDeps
 * @property {Document} doc
 * @property {Window & typeof globalThis} win
 * @property {Promise<import('./store.js').ImageStore>} store
 * @property {(item: import('./store.js').ImageRecord) => import('./open.js').OpenResult} open  synchronous, so the tab opens inside the click
 * @property {(item: import('./store.js').ImageRecord) => Promise<void>} retry  re-probes an unavailable image; rejects while it stays unavailable
 * @property {(err: unknown) => void} report
 * @property {() => boolean} [quickview]  read at each tile click: whether it opens the media popover
 * @property {() => boolean} [includeMine]  the Include my images setting, read for My Images' empty state
 * @property {() => string} [self]  the current user's name in the form images.user stores, empty while
 *   logged out — the one capture reads (start.js); without it, My Images stays hidden
 */

/**
 * @typedef {object} Tile
 * @property {HTMLElement} el
 * @property {HTMLButtonElement} star
 * @property {HTMLButtonElement} trash
 * @property {HTMLElement} badge   the broken-link badge, titled with the failure's reason
 * @property {HTMLElement} size    the size-on-disk chip
 * @property {import('./store.js').ImageRecord} item
 * @property {string | null} url   the thumbnail's object URL
 * @property {Map<string, { button: HTMLButtonElement, action: import('./api.js').GalleryItemAction }>} actions
 */

/**
 * A registered action's state on one item, kept at module scope rather than by the tile or the
 * view, since a registry change rebuilds every tile and the rail renders a new view on every
 * open. No entry is idle; neither is a cooling one past its `until` (a Date.now() time).
 * @typedef {{ state: 'busy' } | { state: 'cooling', until: number } | { state: 'failed', reason: string }} ActionState
 */

/** @type {Map<string, Map<string, ActionState>>} item id → action id → its state */
const actionStates = new Map();
/** @type {Set<(itemId: string, actionId: string) => void>} each mounted view's redraw of one action */
const actionListeners = new Set();

/**
 * @param {string} itemId
 * @param {string} actionId
 * @returns {ActionState | undefined}
 */
function getActionState(itemId, actionId) {
  const st = actionStates.get(itemId)?.get(actionId);
  if (st?.state !== 'cooling' || Date.now() < st.until) return st;
  setActionState(itemId, actionId, null, false);
  return undefined;
}

/**
 * @param {string} itemId
 * @param {string} actionId
 * @param {ActionState | null} next  null returns it to idle
 * @param {boolean} [notify]  false skips telling the mounted views
 */
function setActionState(itemId, actionId, next, notify = true) {
  let byAction = actionStates.get(itemId);
  if (next) {
    if (!byAction) actionStates.set(itemId, (byAction = new Map()));
    byAction.set(actionId, next);
  } else if (byAction) {
    byAction.delete(actionId);
    if (!byAction.size) actionStates.delete(itemId);
  }
  if (notify) for (const listener of [...actionListeners]) listener(itemId, actionId);
}

/**
 * Put `els` into `parent` in order, moving only the ones not already in place. Children that
 * are not in `els` are left for the caller to remove; any still present end up after `els`.
 * @param {Element} parent
 * @param {Element[]} els
 */
function reconcile(parent, els) {
  let cursor = parent.firstElementChild;
  for (const el of els) {
    if (el === cursor) cursor = cursor.nextElementSibling;
    else parent.insertBefore(el, cursor);
  }
}

/** Test only: forget every action's state, so one test's in-flight, cooling or failed action does not leak into the next. */
export function resetGalleryActionStates() {
  actionStates.clear();
}

/**
 * @param {HTMLElement} container  the rail's flyout body
 * @param {unknown} arg
 * @param {GalleryDeps} deps
 * @returns {() => void} cleanup
 */
export function renderGallery(
  container,
  arg,
  { doc, win, store: storeReady, open, retry, report, quickview = () => false, includeMine = () => true, self = () => '' },
) {
  const given = /** @type {GalleryArg} */ (arg && typeof arg === 'object' ? arg : undefined);
  /** @type {{ user: string, label: string } | null} */
  let userFilter = given?.user ? { user: given.user, label: given.label || given.user } : null;
  let favOnly = false;
  let mineOnly = false;
  let closed = false;
  let token = 0;
  /** @type {Map<string, Tile>} */
  let tiles = new Map();
  /** @type {import('./store.js').ImageStore | null} */
  let store = null;
  /** @type {{ close: () => void, layer: HTMLElement, urls: string[] } | null} the popover a tile opened */
  let popover = null;

  const root = doc.createElement('div');
  root.className = 'tdf-gallery';
  const head = doc.createElement('div');
  head.className = 'tdf-gallery-head';
  const title = doc.createElement('span');
  title.className = 'tdf-gallery-title';
  title.textContent = 'Gallery';
  const stats = doc.createElement('span');
  stats.className = 'tdf-gallery-stats';
  const chip = doc.createElement('span');
  chip.className = 'tdf-gallery-chip';
  const favFilter = doc.createElement('button');
  favFilter.type = 'button';
  favFilter.className = 'tdf-gallery-favfilter';
  favFilter.title = 'Show favourites only';
  favFilter.setAttribute('aria-label', 'Show favourites only');
  favFilter.setAttribute('aria-pressed', 'false');
  favFilter.innerHTML = ICONS.star;
  const mineFilter = doc.createElement('button');
  mineFilter.type = 'button';
  mineFilter.className = 'tdf-gallery-minefilter';
  mineFilter.title = 'Show my images only';
  mineFilter.setAttribute('aria-label', 'Show my images only');
  mineFilter.setAttribute('aria-pressed', 'false');
  mineFilter.innerHTML = ICONS.person;
  head.append(title, stats, chip, mineFilter, favFilter);
  const errors = doc.createElement('div');
  errors.className = 'tdf-gallery-error';
  errors.setAttribute('role', 'status');
  errors.title = 'Click to dismiss';
  errors.addEventListener('click', () => clearGalleryErrors());
  const grid = doc.createElement('div');
  grid.className = 'tdf-gallery-grid';
  const empty = doc.createElement('p');
  empty.className = 'tdf-gallery-empty';
  empty.hidden = true;
  root.append(head, errors, grid, empty);
  container.appendChild(root);

  function renderErrors() {
    const list = listGalleryErrors();
    errors.hidden = list.length === 0;
    errors.replaceChildren(...list.map((m) => Object.assign(doc.createElement('div'), { textContent: m })));
  }

  /** Hide My Images while no user name is known, and drop its filter with it. */
  function syncMine() {
    mineFilter.hidden = !self();
    if (mineFilter.hidden && mineOnly) {
      mineOnly = false;
      mineFilter.setAttribute('aria-pressed', 'false');
    }
  }

  mineFilter.addEventListener('click', () => {
    mineOnly = !mineOnly;
    mineFilter.setAttribute('aria-pressed', String(mineOnly));
    if (mineOnly && userFilter) {
      userFilter = null;
      renderChip();
    }
    void refresh();
  });

  favFilter.addEventListener('click', () => {
    favOnly = !favOnly;
    favFilter.setAttribute('aria-pressed', String(favOnly));
    void refresh();
  });

  function renderChip() {
    chip.replaceChildren();
    chip.hidden = !userFilter;
    if (!userFilter) return;
    const label = doc.createElement('span');
    label.textContent = `Showing ${userFilter.label}`;
    const clear = doc.createElement('button');
    clear.type = 'button';
    clear.className = 'tdf-gallery-chip-clear';
    clear.textContent = '×';
    clear.title = 'Show everyone’s images';
    clear.setAttribute('aria-label', 'Show everyone’s images');
    clear.addEventListener('click', () => {
      userFilter = null;
      renderChip();
      void refresh();
    });
    chip.append(label, clear);
  }

  /** @type {Set<string>} ids whose retry is running, so each retries once at a time */
  const retrying = new Set();

  /** @type {Map<string, ReturnType<typeof setTimeout>>} item id + action id → this view's timer to redraw a cooldown's end, cleared on close */
  const cooldowns = new Map();

  /**
   * @param {string} itemId
   * @param {string} actionId
   */
  function redrawAction(itemId, actionId) {
    const tile = tiles.get(itemId);
    if (tile) applyAction(tile, actionId);
  }
  actionListeners.add(redrawAction);

  /**
   * Draw one action button from its item and state. aria-disabled, not disabled, so a click on
   * it is still this button's to swallow rather than falling through to the tile's open.
   * @param {Tile} tile
   * @param {string} actionId
   */
  function applyAction(tile, actionId) {
    const entry = tile.actions.get(actionId);
    if (!entry) return;
    const { button, action } = entry;
    const itemId = tile.item.id;
    const st = getActionState(itemId, actionId);
    const key = `${itemId}\u0000${actionId}`;
    if (st?.state === 'cooling' && !cooldowns.has(key)) {
      cooldowns.set(
        key,
        win.setTimeout(() => {
          cooldowns.delete(key);
          redrawAction(itemId, actionId);
        }, Math.max(0, st.until - Date.now())),
      );
    }
    /** @type {string | null} */
    let reason = null;
    try {
      reason = action.disabled?.(tile.item) ?? null;
    } catch (err) {
      report(err);
    }
    const blocked = Boolean(reason) || st?.state === 'busy' || st?.state === 'cooling';
    button.setAttribute('aria-disabled', String(blocked));
    button.classList.toggle('tdf-busy', st?.state === 'busy');
    button.classList.toggle('tdf-failed', st?.state === 'failed');
    if (st?.state === 'busy') button.setAttribute('aria-busy', 'true');
    else button.removeAttribute('aria-busy');
    const label = reason
      ? reason
      : st?.state === 'busy'
        ? `${action.label}…`
        : st?.state === 'cooling'
          ? `${action.label} — done`
          : st?.state === 'failed'
            ? `${action.label} failed: ${st.reason}`
            : action.label;
    button.title = label;
    button.setAttribute('aria-label', label);
  }

  /**
   * Run a registered action from its button. A synchronous action is called as before; a
   * returned Promise holds the button busy, then cooling or failed. Its settling is recorded
   * even once this view has closed, so the next open draws it.
   * @param {Tile} tile
   * @param {string} actionId
   */
  function runAction(tile, actionId) {
    const entry = tile.actions.get(actionId);
    if (!entry || entry.button.getAttribute('aria-disabled') === 'true') return;
    const { action } = entry;
    const current = tiles.get(tile.item.id)?.item ?? tile.item;
    const itemId = current.id;
    /** @type {void | Promise<void>} */
    let result;
    try {
      result = action.onSelect(current);
    } catch (err) {
      report(err);
      return;
    }
    if (!result || typeof result.then !== 'function') return;
    setActionState(itemId, actionId, { state: 'busy' });
    result.then(
      () => {
        const ms = action.cooldownMs ?? 0;
        setActionState(itemId, actionId, ms > 0 ? { state: 'cooling', until: Date.now() + ms } : null);
      },
      (err) => {
        setActionState(itemId, actionId, { state: 'failed', reason: err instanceof Error ? err.message : String(err) });
        report(err);
      },
    );
  }

  /**
   * A tile's own action: open the image in a new tab, or retry one that is unavailable. Nothing
   * is awaited before open: the browser blocks a tab opened outside the click. Its store change
   * redraws the tile.
   * @param {import('./store.js').ImageRecord} item
   */
  function activate(item) {
    if (isUnavailable(item)) {
      if (retrying.has(item.id)) return;
      retrying.add(item.id);
      retry(item)
        .catch(report)
        .finally(() => retrying.delete(item.id));
      return;
    }
    try {
      if (open(item) === 'blocked') report(new Error('gallery: the browser blocked the new tab'));
    } catch (err) {
      report(err);
    }
  }

  /**
   * The media popover at a tile, over the tiles shown, in display order. Zoom is the tile's
   * own action on the record as it is when zoomed.
   * @param {Tile} tile
   */
  function openQuickview(tile) {
    endPopover();
    const host = doc.getElementById('tdf-chat');
    const shown = [...tiles.values()];
    /** @type {Map<string, import('./store.js').ImageRecord>} */
    const records = new Map(shown.map((t) => [t.item.id, t.item]));
    /** @type {string[]} */
    const urls = [];
    const items = shown.map((t) => {
      // The stored original when open.js would open it (a raster blob), else the share URL.
      const blob = t.item.blob && !isUnavailable({ broken: true, blob: t.item.blob }) ? t.item.blob : null;
      const src = blob ? win.URL.createObjectURL(blob) : shareUrl(t.item.id, win.location.href);
      if (blob) urls.push(src);
      return { id: t.item.id, src, thumb: t.url, kind: /** @type {const} */ ('unknown') };
    });
    const { close, layer } = openLightbox({
      doc,
      win,
      host,
      items,
      index: Math.max(0, shown.indexOf(tile)),
      zoom: (media) => {
        const record = tiles.get(media.id)?.item ?? records.get(media.id);
        if (record) activate(record);
      },
      report,
      opener: tile.el,
    });
    popover = { close, layer, urls };
  }

  /** Close the popover this gallery opened, then give back the object URLs it was showing. */
  function endPopover() {
    if (!popover) return;
    const { close, urls } = popover;
    popover = null;
    close();
    for (const url of urls) win.URL.revokeObjectURL(url);
  }

  /** @param {Tile} tile */
  function dropTile(tile) {
    if (popover && !popover.layer.isConnected) endPopover();
    // An open popover's filmstrip still shows the thumbnail, so it is given back when that closes.
    if (tile.url) {
      if (popover) popover.urls.push(tile.url);
      else win.URL.revokeObjectURL(tile.url);
    }
    tile.el.remove();
  }

  /** @param {import('./store.js').ImageRecord} item */
  function buildTile(item) {
    const el = doc.createElement('div');
    el.className = 'tdf-gallery-tile';
    el.dataset.id = item.id;
    // Open is the tile's own action, so the tile is a keyboard-reachable button.
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    /** @type {string | null} */
    let url = null;
    if (item.thumb) {
      url = win.URL.createObjectURL(item.thumb);
      const img = doc.createElement('img');
      img.className = 'tdf-gallery-thumb';
      img.alt = `Image from ${item.user}`;
      img.decoding = 'async';
      // The browser's own image drag would cancel the pointer drag.
      img.draggable = false;
      img.addEventListener('load', () => img.classList.add('tdf-ready'), { once: true });
      img.src = url;
      if (img.complete && img.naturalWidth) img.classList.add('tdf-ready');
      el.appendChild(img);
    } else {
      const placeholder = doc.createElement('div');
      placeholder.className = 'tdf-gallery-thumb tdf-gallery-placeholder tdf-ready';
      el.appendChild(placeholder);
    }
    const badge = doc.createElement('span');
    badge.className = 'tdf-gallery-broken';
    badge.innerHTML = ICONS.broken;
    const unavailable = doc.createElement('span');
    unavailable.className = 'tdf-gallery-unavailable';
    unavailable.textContent = UNAVAILABLE;
    // After the wash, so an unavailable tile still shows its size above it.
    const size = doc.createElement('span');
    size.className = 'tdf-gallery-size';
    const trash = doc.createElement('button');
    trash.type = 'button';
    trash.className = 'tdf-gallery-btn tdf-gallery-trash';
    trash.innerHTML = ICONS.trash;
    const star = doc.createElement('button');
    star.type = 'button';
    star.className = 'tdf-gallery-btn tdf-gallery-star';
    star.innerHTML = ICONS.star;
    el.append(badge, unavailable, size, trash, star);

    /** @type {Tile} */
    const tile = { el, star, trash, badge, size, item, url, actions: new Map() };

    const actions = listGalleryItemActions();
    if (actions.length) {
      const bar = doc.createElement('div');
      bar.className = 'tdf-gallery-actions';
      for (const action of actions) {
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = 'tdf-gallery-action';
        b.dataset.action = action.id;
        b.title = action.label;
        b.setAttribute('aria-label', action.label);
        renderIcon(b, action.icon || action.label);
        b.addEventListener('click', (event) => {
          event.stopPropagation();
          runAction(tile, action.id);
        });
        tile.actions.set(action.id, { button: b, action });
        bar.appendChild(b);
      }
      el.appendChild(bar);
    }

    star.addEventListener('click', (event) => {
      event.stopPropagation();
      store?.setFavorite(tile.item.id, !tile.item.favorite).catch(report);
    });
    trash.addEventListener('click', (event) => {
      event.stopPropagation();
      if (tile.item.favorite || !store) return;
      const s = store;
      // Removed once the shrink has played; under reduced motion the tile just goes.
      el.classList.add('tdf-removing');
      win.setTimeout(() => {
        s.remove(tile.item.id).catch((err) => {
          el.classList.remove('tdf-removing');
          report(err);
        });
      }, REMOVE_MS);
    });
    // Quickview, read at each click, opens the popover; an unavailable tile retries either way.
    const openTile = () => {
      if (isUnavailable(tile.item) || !quickview()) {
        activate(tile.item);
        return;
      }
      try {
        openQuickview(tile);
      } catch (err) {
        report(err);
      }
    };
    el.addEventListener('click', openTile);
    el.addEventListener('keydown', (event) => {
      // Enter or Space on the tile itself; its own buttons handle their keys.
      if (event.target !== el || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      openTile();
    });

    for (const decorate of listGalleryItemDecorations()) {
      try {
        decorate(item, el);
      } catch (err) {
        report(err);
      }
    }
    return tile;
  }

  /** @param {Tile} tile */
  function updateTile(tile) {
    const { item } = tile;
    tile.el.classList.toggle('tdf-fav', item.favorite);
    tile.el.classList.toggle('tdf-broken', item.broken);
    const gone = isUnavailable(item);
    tile.el.classList.toggle('tdf-unavailable', gone);
    // Not aria-disabled: activating an unavailable tile retries it.
    tile.el.title = gone
      ? `${UNAVAILABLE}${item.brokenReason ? `: ${item.brokenReason}` : ''} — click to retry`
      : `${item.user} — click to open`;
    tile.el.setAttribute(
      'aria-label',
      gone ? `Image from ${item.user} unavailable from server — activate to retry` : `Open image from ${item.user}`,
    );
    tile.badge.title = item.brokenReason
      ? `The server copy no longer loads: ${item.brokenReason}`
      : 'The server copy no longer loads';
    tile.size.textContent = formatBytes(item.bytes);
    tile.size.classList.toggle('tdf-large', isLarge(item.bytes));
    tile.star.setAttribute('aria-pressed', String(item.favorite));
    const starLabel = item.favorite ? 'Remove from favourites' : 'Add to favourites';
    tile.star.title = starLabel;
    tile.star.setAttribute('aria-label', starLabel);
    tile.trash.disabled = item.favorite;
    const trashLabel = item.favorite ? 'Favourites cannot be deleted' : 'Delete permanently';
    tile.trash.title = trashLabel;
    tile.trash.setAttribute('aria-label', trashLabel);
    for (const actionId of tile.actions.keys()) applyAction(tile, actionId);
  }

  /** @param {import('./store.js').ImageStore} s */
  async function load(s) {
    if (mineOnly) return displayOrder(await s.listByUser(self()));
    if (!userFilter) return s.list();
    const names = [...new Set([userFilter.user, userFilter.label])];
    const lists = await Promise.all(names.map((n) => s.listByUser(n)));
    const byId = new Map(lists.flat().map((r) => [r.id, r]));
    return displayOrder([...byId.values()]);
  }

  async function refresh() {
    // A store change mid-drag waits for the drop, so the grid does not move under the pointer.
    if (drag?.started) {
      refreshOwed = true;
      return;
    }
    const mine = ++token;
    syncMine();
    try {
      const s = store ?? (store = await storeReady);
      const [items, totals] = await Promise.all([load(s), s.stats()]);
      if (closed || mine !== token) return;
      // A refresh that began before a drag started finishes after the drop instead.
      if (drag?.started) {
        refreshOwed = true;
        return;
      }

      const size = totals.originals + totals.thumbs;
      stats.textContent = `${totals.count} image${totals.count === 1 ? '' : 's'} · ${formatBytes(size)}`;
      stats.title =
        `Originals: ${formatBytes(totals.originals)} · Thumbnails: ${formatBytes(totals.thumbs)} · ` +
        `Favourites: ${totals.favorites}`;

      const shown = favOnly ? items.filter((r) => r.favorite) : items;
      /** @type {Map<string, Tile>} */
      const next = new Map();
      shown.forEach((item, i) => {
        const tile = tiles.get(item.id) ?? buildTile(item);
        tile.item = item;
        tile.el.style.setProperty('--i', String(i));
        updateTile(tile);
        next.set(item.id, tile);
      });
      for (const [id, tile] of tiles) if (!next.has(id)) dropTile(tile);
      tiles = next;
      reconcile(grid, [...next.values()].map((t) => t.el));

      empty.hidden = shown.length > 0;
      empty.textContent = mineOnly
        ? favOnly
          ? 'None of your images are favourites yet.'
          : `No images from you yet.${includeMine() ? '' : ' Include my images is off, so only images saved before it was turned off are kept.'}`
        : favOnly
        ? 'No favourites yet. Star an image to keep it here.'
        : userFilter
          ? `No images from ${userFilter.label} yet`
          : 'No images yet';
    } catch (err) {
      if (!closed) report(err);
    }
  }

  /**
   * A press on a tile that may become a drag, then the drag itself (TDF-0060).
   * @typedef {object} Drag
   * @property {Tile} tile
   * @property {number} pointerId
   * @property {string} pointerType
   * @property {number} startX     where the press, then the drag, began
   * @property {number} startY
   * @property {number} x          the pointer's latest position
   * @property {number} y
   * @property {boolean} started
   * @property {ReturnType<typeof setTimeout> | null} hold   a touch's long-press timer
   * @property {HTMLElement | null} slot   where the tile will drop
   * @property {number} startScroll  the flyout body's scrollTop when the drag began
   * @property {number} frame      the auto-scroll's animation frame, 0 for none
   */
  /** @type {Drag | null} */
  let drag = null;
  let refreshOwed = false;
  let swallowClick = false;

  /** The tiles and the slot in grid order, without the tile being dragged. */
  const cells = () =>
    /** @type {HTMLElement[]} */ ([...grid.children]).filter(
      (c) =>
        !c.classList.contains('tdf-dragging') &&
        (c.classList.contains('tdf-gallery-tile') || c.classList.contains('tdf-gallery-slot')),
    );

  /** @param {PointerEvent} event */
  function onPointerDown(event) {
    if (drag || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const target = /** @type {Element | null} */ (event.target);
    // The star, trash, Post and every other action button keep their own press.
    if (!target || target.closest('button')) return;
    const el = target.closest('.tdf-gallery-tile');
    const tile = [...tiles.values()].find((t) => t.el === el);
    if (!tile || tile.el.classList.contains('tdf-removing')) return;
    drag = {
      tile,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      started: false,
      hold: null,
      slot: null,
      startScroll: container.scrollTop,
      frame: 0,
    };
    if (event.pointerType === 'touch') {
      const pending = drag;
      pending.hold = win.setTimeout(() => {
        pending.hold = null;
        if (drag === pending) startDrag();
      }, TOUCH_HOLD_MS);
    }
    doc.addEventListener('pointermove', onPointerMove);
    doc.addEventListener('pointerup', onPointerUp);
    doc.addEventListener('pointercancel', onPointerCancel);
    doc.addEventListener('keydown', onKeyDown);
  }

  /** @param {PointerEvent} event */
  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (!drag.started) {
      if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < DRAG_SLOP_PX) return;
      // A touch that moves before its hold is a scroll; a mouse or pen that moves is a drag.
      if (drag.pointerType === 'touch') endPress();
      else startDrag();
      return;
    }
    event.preventDefault();
    follow();
    autoScroll();
  }

  /** Lift the pressed tile out of the grid's flow and leave a slot where it was. */
  function startDrag() {
    if (!drag) return;
    const { tile } = drag;
    // A refresh before the threshold may have dropped the pressed tile.
    if (!tile.el.isConnected || tiles.get(tile.item.id) !== tile) {
      endPress();
      return;
    }
    endPopover();
    const rect = tile.el.getBoundingClientRect();
    const box = grid.getBoundingClientRect();
    const slot = doc.createElement('div');
    slot.className = 'tdf-gallery-slot';
    grid.insertBefore(slot, tile.el);
    drag.slot = slot;
    drag.started = true;
    drag.startX = drag.x;
    drag.startY = drag.y;
    drag.startScroll = container.scrollTop;
    tile.el.classList.add('tdf-dragging');
    tile.el.style.left = `${rect.left - box.left}px`;
    tile.el.style.top = `${rect.top - box.top}px`;
    try {
      tile.el.setPointerCapture(drag.pointerId);
    } catch {
      // A pointer already released cannot be captured; the document's listeners still follow it.
    }
    follow();
  }

  /** Keep the lifted tile under the pointer and move the slot to the cell it is over. */
  function follow() {
    if (!drag?.slot) return;
    const { slot } = drag;
    const dx = drag.x - drag.startX;
    const dy = drag.y - drag.startY + (container.scrollTop - drag.startScroll);
    drag.tile.el.style.transform = `translate(${dx}px, ${dy}px)`;
    const list = cells();
    /** @type {HTMLElement | null} */
    let over = null;
    let best = Infinity;
    for (const c of list) {
      const r = c.getBoundingClientRect();
      const inside = drag.x >= r.left && drag.x <= r.right && drag.y >= r.top && drag.y <= r.bottom;
      const d = inside ? -1 : Math.hypot(drag.x - (r.left + r.right) / 2, drag.y - (r.top + r.bottom) / 2);
      if (d < best) {
        best = d;
        over = c;
      }
    }
    if (!over || over === slot) return;
    // The slot takes the cell it is over: after that tile when the slot was before it, else before.
    if (list.indexOf(slot) < list.indexOf(over)) grid.insertBefore(slot, over.nextSibling);
    else grid.insertBefore(slot, over);
  }

  /** While the pointer is near the flyout body's top or bottom edge, scroll it, once a frame. */
  function autoScroll() {
    if (!drag?.started || drag.frame) return;
    const box = container.getBoundingClientRect();
    if (box.height <= 0) return;
    // The sticky header covers the body's top, so the top zone starts below it.
    const top = Math.max(box.top, head.getBoundingClientRect().bottom);
    const step =
      drag.y < top + EDGE_PX ? drag.y - (top + EDGE_PX) : drag.y > box.bottom - EDGE_PX ? drag.y - (box.bottom - EDGE_PX) : 0;
    if (!step) return;
    const current = drag;
    current.frame = win.requestAnimationFrame(() => {
      current.frame = 0;
      if (drag !== current) return;
      const before = container.scrollTop;
      container.scrollTop += Math.sign(step) * Math.ceil(Math.min(EDGE_PX, Math.abs(step)) / 4);
      if (container.scrollTop === before) return;
      follow();
      autoScroll();
    });
  }

  /** @param {PointerEvent} event */
  function onPointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.started) {
      // A press that never became a drag: its click opens the tile as before.
      endPress();
      return;
    }
    const { tile, slot } = drag;
    const list = cells();
    const at = slot ? list.indexOf(slot) : -1;
    // Beside the tile's own element is where it started, so nothing is written.
    const moved =
      slot !== null && at !== -1 && slot.nextElementSibling !== tile.el && slot.previousElementSibling !== tile.el;
    const others = list.filter((c) => c !== slot);
    const above = moved ? (others[at - 1] ?? null) : null;
    const below = moved ? (others[at] ?? null) : null;
    if (slot) grid.insertBefore(tile.el, slot);
    swallowClick = true;
    win.setTimeout(() => {
      swallowClick = false;
    }, 0);
    if (!moved || !store) {
      endPress();
      return;
    }
    // An owed refresh waits for the move, or it would read the old order and snap the tile back.
    const write = store.move(tile.item.id, above?.dataset.id ?? null, below?.dataset.id ?? null);
    const owed = refreshOwed;
    refreshOwed = false;
    endPress();
    write.then(
      () => {
        if (owed && !closed) void refresh();
      },
      (err) => {
        report(err);
        if (!closed) void refresh();
      },
    );
  }

  /** @param {PointerEvent} event */
  function onPointerCancel(event) {
    if (drag && event.pointerId === drag.pointerId) endPress();
  }

  /** @param {KeyboardEvent} event */
  function onKeyDown(event) {
    if (event.key !== 'Escape' || !drag?.started) return;
    event.preventDefault();
    event.stopPropagation();
    endPress();
  }

  /** End the press or drag; a tile not dropped stays where it was. Then run a refresh it held. */
  function endPress() {
    const ending = drag;
    if (!ending) return;
    drag = null;
    if (ending.hold !== null) win.clearTimeout(ending.hold);
    if (ending.frame) win.cancelAnimationFrame(ending.frame);
    doc.removeEventListener('pointermove', onPointerMove);
    doc.removeEventListener('pointerup', onPointerUp);
    doc.removeEventListener('pointercancel', onPointerCancel);
    doc.removeEventListener('keydown', onKeyDown);
    const { el } = ending.tile;
    ending.slot?.remove();
    el.classList.remove('tdf-dragging');
    el.style.removeProperty('left');
    el.style.removeProperty('top');
    el.style.removeProperty('transform');
    try {
      if (el.hasPointerCapture(ending.pointerId)) el.releasePointerCapture(ending.pointerId);
    } catch {
      // Already released.
    }
    if (refreshOwed && !closed) {
      refreshOwed = false;
      void refresh();
    }
  }

  grid.addEventListener('pointerdown', onPointerDown);
  // A drag's release still clicks the tile: swallowed here, before the tile's own open sees it.
  root.addEventListener(
    'click',
    (event) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.stopPropagation();
      event.preventDefault();
    },
    true,
  );
  // Once a touch drag has started the flyout must not scroll under it; before, it scrolls natively.
  root.addEventListener(
    'touchmove',
    (event) => {
      if (drag?.started) event.preventDefault();
    },
    { passive: false },
  );
  // A long-press would otherwise open the browser's image menu.
  root.addEventListener('contextmenu', (event) => {
    if (drag) event.preventDefault();
  });
  grid.addEventListener('dragstart', (event) => event.preventDefault());

  // A registry change redraws every tile, so actions and decorations apply to all of them.
  const offRegistry = onGalleryRegistryChange(() => {
    endPress();
    for (const tile of tiles.values()) dropTile(tile);
    tiles = new Map();
    void refresh();
  });
  const offImages = onImagesChange(() => void refresh());
  const offErrors = onGalleryErrors(renderErrors);

  renderChip();
  renderErrors();
  void refresh();

  return () => {
    closed = true;
    endPress();
    refreshOwed = false;
    offRegistry();
    offImages();
    offErrors();
    actionListeners.delete(redrawAction);
    for (const timer of cooldowns.values()) win.clearTimeout(timer);
    cooldowns.clear();
    endPopover();
    for (const tile of tiles.values()) dropTile(tile);
    tiles = new Map();
    root.remove();
  };
}
