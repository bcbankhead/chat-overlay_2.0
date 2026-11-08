// The gallery's wiring, apart from index.js's double-load guard so a test can drive it.
// Capture subscribes at once, so no live share or like is missed while the database opens; the
// Gallery button joins the sidebar's icon row through registerRailPanel, and "View images"
// joins a user's menu, online or ghosted, only while the gallery holds an image from them
// (TDF-0075.2), opening the flyout filtered to that sender. With Compress stored
// images on, originals stored before are compressed in the background once the database opens,
// and again from the moment the setting is switched on (TDF-0036). Each tile carries Re-post
// (TDF-0038, TDF-0062), which posts its image at once through the composer's upload route and
// whisper rule, reached only through the composer's api.js. One Re-post ledger is shared by
// Re-post and capture, so a re-posted image is not captured into the gallery again (TDF-0063).

import { openDb } from '../../core/db.js';
import { onInbound, onLiked } from '../../core/events.js';
import { createHistory } from '../../core/history.js';
import { createSettings, followSetting, onSettingChange } from '../../core/settings.js';
import { registerRailPanel, registerUserMenuAction } from '../rail/api.js';
import { uploadAttachment, whisperTo } from '../composer/api.js';
import { registerGalleryItemAction } from './api.js';
import { startCapture } from './capture.js';
import { fetchShare } from './fetchShare.js';
import { isUnavailable, openImage, retryImage } from './open.js';
import { reportGalleryError } from './errors.js';
import { compressOriginal } from './reencode.js';
import { sha256Hex } from './hash.js';
import { createRepostAction } from './repost.js';
import { createRepostLedger } from './reposted.js';
import { createSenderSet } from './senders.js';
import { createImageStore, onImagesChange } from './store.js';
import { makeThumb } from './thumb.js';
import { renderGallery } from './view.js';

/** Phosphor "Image", duotone, as the rail's own icons (rail/icons.js has no gallery glyph). */
const GALLERY_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">' +
  '<path d="M224,56V178.06l-39.72-39.72a8,8,0,0,0-11.31,0L147.31,164,97.66,114.34a8,8,0,0,0-11.32,0L32,168.69V56a8,8,0,0,1,8-8H216A8,8,0,0,1,224,56Z" opacity="0.2"/>' +
  '<path d="M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,16V158.75l-26.07-26.06a16,16,0,0,0-22.63,0l-20,20-44-44a16,16,0,0,0-22.62,0L40,149.37V56ZM40,172l52-52,80,80H40Zm176,28H194.63l-36-36,20-20L216,181.38V200ZM144,100a12,12,0,1,1,12,12A12,12,0,0,1,144,100Z"/>' +
  '</svg>';

/**
 * @param {{ win: Window & typeof globalThis, doc: Document, css: string, indexedDB?: IDBFactory }} deps
 */
export function startGallery({ win, doc, css, indexedDB = win.indexedDB }) {
  const report = reportGalleryError;
  /** @type {typeof globalThis.fetch} */
  const fetch = (input, init) => win.fetch(input, init);

  const db = openDb({ indexedDB });
  // Reported once, through ready below.
  db.catch(() => {});
  const ready = db.then((opened) => ({ store: createImageStore(opened), settings: createSettings(opened) }));
  ready.catch(report);
  const storeReady = ready.then((r) => r.store);
  // Reported once, above; a flyout opened later reports it again from its own load.
  storeReady.catch(() => {});
  // Read at each tile click (view.js), which cannot await; a failed open is reported above, a
  // failed read through report.
  const quickview = followSetting(ready.then((r) => r.settings), 'useMediaQuickview', report);
  // Read for My Images' empty state (TDF-0046): with it off, only own images saved earlier remain.
  const includeMine = followSetting(ready.then((r) => r.settings), 'includeMyImages', report);
  // The form engine-hook.js compares to mUser, which is what images.user stores. One reader for
  // capture and My Images (TDF-0046), so what is saved as yours and what is shown as yours agree.
  const self = () => String(/** @type {any} */ (win).userName ?? '');

  const reposted = createRepostLedger();
  const capture = startCapture({
    ready,
    onInbound,
    onLiked,
    getMessage: async (id) => createHistory(await db).get(id),
    roomID: () => String(win.roomID ?? ''),
    fetch,
    makeThumb: (blob) => makeThumb(blob),
    base: () => win.location.href,
    report,
    self,
    compress: (blob) => compressOriginal(blob),
    reposted,
  });
  const backfill = () => capture.backfill().catch(report);
  ready.then(
    async ({ settings }) => {
      if (await settings.get('compressStoredImages')) await backfill();
    },
    // Reported once, above.
    () => {},
  ).catch(report);
  onSettingChange((key, value) => {
    if (key === 'compressStoredImages' && value === true) backfill();
  });

  if (!doc.getElementById('tdf-gallery-style')) {
    const style = doc.createElement('style');
    style.id = 'tdf-gallery-style';
    style.textContent = css;
    doc.head.appendChild(style);
  }

  const panel = registerRailPanel({
    id: 'gallery',
    title: 'Gallery',
    icon: GALLERY_ICON,
    order: 10,
    render: (container, arg) =>
      renderGallery(container, arg, {
        doc,
        win,
        store: storeReady,
        report,
        open: (item) => openImage(item, { win, store: storeReady, fetch, report }),
        retry: (item) => retryImage(item, { win, store: storeReady, fetch }),
        quickview,
        includeMine,
        self,
      }),
  });

  // Re-post (TDF-0062): posts the tile's image at once, then cools down; the flyout stays open.
  registerGalleryItemAction(
    createRepostAction({
      upload: (file, toUser) => uploadAttachment(file, toUser),
      whisperTo: () => whisperTo(),
      fetchShare: (id) => fetchShare(id, { base: win.location.href, fetch }),
      isUnavailable,
      hash: (blob) => sha256Hex(blob),
      ledger: reposted,
      report,
    }),
  );

  // Who the gallery holds images from, for View images' synchronous gate: read once the store
  // opens and again after every write; hidden until the first read lands. A failed open is
  // reported once, above, and reads as no senders; only a failed walk reaches report here.
  const senders = createSenderSet({
    read: () => storeReady.then((s) => s.senders(), () => new Set()),
    report,
  });
  senders.refresh();
  onImagesChange(() => void senders.refresh());

  registerUserMenuAction({
    id: 'gallery-view-images',
    label: 'View images',
    icon: GALLERY_ICON,
    isVisible: (user) => senders.has(user.rawName),
    run: (user) => panel.open({ user: user.rawName, label: user.name }),
  });
}
