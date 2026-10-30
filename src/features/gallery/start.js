// The gallery's wiring, apart from index.js's double-load guard so a test can drive it.
// Capture subscribes at once, so no live share is missed while the database opens; the
// Gallery button joins the sidebar's icon row through registerRailPanel, and "View images"
// joins every user's menu, opening the flyout filtered to that sender.

import { openDb } from '../../core/db.js';
import { onInbound } from '../../core/events.js';
import { createSettings } from '../../core/settings.js';
import { registerRailPanel, registerUserMenuAction } from '../rail/api.js';
import { startCapture } from './capture.js';
import { reportGalleryError } from './errors.js';
import { saveImage } from './save.js';
import { createImageStore } from './store.js';
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

  const ready = openDb({ indexedDB }).then((db) => ({ store: createImageStore(db), settings: createSettings(db) }));
  ready.catch(report);
  const storeReady = ready.then((r) => r.store);
  // Reported once, above; a flyout opened later reports it again from its own load.
  storeReady.catch(() => {});

  startCapture({
    ready,
    onInbound,
    fetch,
    makeThumb: (blob) => makeThumb(blob),
    base: () => win.location.href,
    report,
    // The form engine-hook.js compares to mUser, which is what images.user stores.
    self: () => String(/** @type {any} */ (win).userName ?? ''),
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
        save: async (item) => saveImage(item, { store: await storeReady, win, doc, fetch }),
      }),
  });

  registerUserMenuAction({
    id: 'gallery-view-images',
    label: 'View images',
    icon: GALLERY_ICON,
    run: (user) => panel.open({ user: user.rawName, label: user.name }),
  });
}
