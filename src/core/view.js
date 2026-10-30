// The message view: a linear list overlaid on #chatContainer. The engine's container stays
// in the DOM, hidden, so its scrolling and trimming keep working underneath.

import { expand } from './expand.js';
import { clockHHMM, continuesGroup, groupTime } from './group.js';
import { DEFAULT_REPLAY_LIMIT } from './history.js';
import { renderAvatar } from './avatar.js';
import { adapt, THEME_BG } from './ink.js';
import { safeDecodeURIComponent } from './parse.js';
import { pickPreview, youtubeThumb } from './preview.js';
import { sanitize } from './sanitize.js';
import { atBottom } from './scroll.js';
import { fixedSmilieSrc } from './smiliefix.js';
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
 * @param {{
 *   doc: Document,
 *   win: Window & { addSmilie?: (text: string) => string, enableEmail?: unknown, enableUrl?: unknown },
 *   container: HTMLElement,
 *   css: string,
 *   avatars?: import('./avatarResolver.js').AvatarResolver | null,
 * }} deps `avatars` looks up forum pictures for senders with no chat avatar
 */
export function createView({ doc, win, container, css, avatars = null }) {
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

  // The engine's Auto-scroll checkbox; absent means on.
  const autoOn = () => {
    const auto = /** @type {HTMLInputElement | null} */ (doc.getElementById('autoScrollID'));
    return !auto || auto.checked;
  };

  // Whether the list rested at its bottom before anything grew it. Stored rather than tested
  // when an image loads, because by then the image has already pushed the bottom away.
  let pinned = true;
  // Where the view last rested at the bottom. A scroll event arrives a frame after the write that
  // caused it, possibly after the list has grown again, so only a move above this point unpins.
  let pinnedTop = 0;
  const settle = () => {
    pinnedTop = list.scrollTop;
    pinned = true;
  };
  list.addEventListener(
    'scroll',
    () => {
      if (atBottom(list)) settle();
      else if (list.scrollTop < pinnedTop - 1) pinned = false;
    },
    { passive: true },
  );

  // A row that grew after it was added: a pinned view follows it back down.
  const followIfPinned = () => {
    if (pinned && autoOn()) {
      list.scrollTop = list.scrollHeight;
      settle();
    }
  };

  // Posted images are told from smilies by size, known only once loaded. `load` does not
  // bubble, so it is caught in the capture phase. A loaded image grows the list, so a pinned
  // view follows it back down.
  list.addEventListener(
    'load',
    (event) => {
      const target = /** @type {Element} */ (event.target);
      if (target.tagName !== 'IMG') return;
      if (target.closest?.('.tdf-body')) tagPosted(/** @type {HTMLImageElement} */ (target));
      followIfPinned();
    },
    true,
  );

  // A preview image that fails falls back to its link's hostname chip, which changes the
  // row's height, so a pinned view follows it as it does a load.
  list.addEventListener(
    'error',
    (event) => {
      const target = /** @type {Element} */ (event.target);
      const block = target.tagName === 'IMG' ? target.closest?.('.tdf-preview') : null;
      const link = block?.querySelector('a');
      const host = /** @type {HTMLElement | null | undefined} */ (block)?.dataset.host;
      if (!block || !link || host === undefined) return;
      asChip(link, host);
      block.replaceChildren(link);
      followIfPinned();
    },
    true,
  );

  /**
   * Make a preview's link a chip naming its host.
   * @param {HTMLAnchorElement} a
   * @param {string} host
   */
  function asChip(a, host) {
    a.className = 'tdf-chip';
    a.textContent = host;
  }

  /**
   * The preview block for a message's first previewable link, or null. Read from the links
   * the sanitiser kept and built with DOM calls only, never from the message's HTML. Its link
   * is a bare copy of the kept anchor, so it opens as that one does.
   * @param {DocumentFragment} content the sanitised body
   */
  function renderPreview(content) {
    /** @type {Set<string>} */
    const shown = new Set();
    for (const img of content.querySelectorAll('img')) {
      const src = img.getAttribute('src');
      if (src !== null) shown.add(src);
      const wrapper = img.closest('a')?.getAttribute('href');
      if (wrapper) shown.add(wrapper);
    }
    const anchors = [...content.querySelectorAll('a[href]')];
    const preview = pickPreview(anchors.map((a) => a.getAttribute('href') ?? ''), shown);
    const kept = preview && anchors.find((a) => a.getAttribute('href') === preview.url);
    if (!preview || !kept) return null;

    const block = doc.createElement('div');
    block.className = 'tdf-preview';
    block.dataset.host = preview.host;
    const a = /** @type {HTMLAnchorElement} */ (kept.cloneNode(false));
    if (preview.kind === 'link') {
      asChip(a, preview.host);
    } else {
      const img = doc.createElement('img');
      img.className = 'tdf-preview-img';
      img.setAttribute('src', preview.kind === 'image' ? preview.url : youtubeThumb(preview.id));
      img.setAttribute('referrerpolicy', 'no-referrer');
      img.setAttribute('loading', 'lazy');
      img.setAttribute('alt', '');
      a.appendChild(img);
      if (preview.kind === 'youtube') {
        const play = doc.createElement('span');
        play.className = 'tdf-play';
        play.textContent = '▶';
        a.appendChild(play);
      }
    }
    block.appendChild(a);
    return block;
  }

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
      el.appendChild(
        renderAvatar(doc, {
          name: safeDecodeURIComponent(record.user),
          file: record.avatar,
          src: `avatars/40/${encodeURIComponent(record.avatar)}`,
          className: 'tdf-avatar',
          resolver: avatars,
        }),
      );
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
    // After sanitising, which keeps only http(s) sources: the cleaned smilies are data URIs.
    for (const img of content.querySelectorAll('img')) {
      const src = img.getAttribute('src');
      if (src !== null) {
        const fixed = fixedSmilieSrc(src);
        if (fixed !== src) img.setAttribute('src', fixed);
      }
    }
    const preview = renderPreview(content);
    if (record.lineBreakFlag === '1') {
      const pre = doc.createElement('pre');
      pre.appendChild(content);
      body.appendChild(pre);
    } else {
      body.appendChild(content);
    }
    line.appendChild(body);
    // Outside the body, so posted-image tagging and the tagging feature never see it.
    if (preview) line.appendChild(preview);
    el.appendChild(line);
    for (const img of body.querySelectorAll('img')) if (img.complete) tagPosted(img);
    return el;
  }

  function autoscroll() {
    // With the switch off a row grows the list without a scroll event, so read where it rests.
    if (!autoOn()) {
      pinned = atBottom(list);
      return;
    }
    list.scrollTop = list.scrollHeight;
    settle();
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

    /**
     * Remove every rendered entry with one of these ids: stored records that were deleted.
     * @param {Iterable<string>} ids
     */
    removeById(ids) {
      for (const id of ids) for (const el of entries('id', id)) remove(el);
    },

    /** Empty the list: every entry and notice goes; the scrollbar's thumb stays. */
    clear() {
      for (const el of [...shown]) /** @type {HTMLElement} */ (el).remove();
      byKey.id.clear();
      byKey.mtime.clear();
      settle();
    },

    notice,
  };
}

/** @typedef {ReturnType<typeof createView>} View */
