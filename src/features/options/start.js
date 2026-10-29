// The Settings wiring, apart from index.js's double-load guard so a test can drive it. The gear
// at the right end of the sidebar's icon row opens the Settings flyout (panel.js). Its own
// connection to the one database, as bootstrap hands features no handle. Both Storage limits
// also run once on load, after the message view has replayed, so lines they delete leave the
// view too; a failure there is kept and shown at the top of the flyout when it next opens.

import { openDb } from '../../core/db.js';
import { describeError } from '../../core/errors.js';
import { createSettings } from '../../core/settings.js';
import { createImageStore } from '../gallery/store.js';
import { registerRailPanel } from '../rail/api.js';
import { GEAR } from './icon.js';
import { createLimits } from './limits.js';
import { renderSettings } from './panel.js';

/**
 * @param {{ win: Window & typeof globalThis, doc: Document, css: string, indexedDB?: IDBFactory }} deps
 */
export function startSettings({ win, doc, css, indexedDB = win.indexedDB }) {
  if (!doc.getElementById('tdf-options-style')) {
    const style = doc.createElement('style');
    style.id = 'tdf-options-style';
    style.textContent = css;
    doc.head.appendChild(style);
  }

  /** @type {string | null} why the load-time limits did not run */
  let loadFailure = null;

  const ready = openDb({ indexedDB }).then((db) => {
    const settings = createSettings(db);
    const gallery = createImageStore(db);
    const limits = createLimits({ db, doc, gallery });
    const galleryBytes = async () => {
      const { originals, thumbs } = await gallery.stats();
      return originals + thumbs;
    };
    return { settings, limits, galleryBytes };
  });

  registerRailPanel({
    id: 'settings',
    title: 'Settings',
    icon: GEAR,
    align: 'end',
    render(container) {
      /** @type {(() => void) | null} */
      let cleanup = null;
      let closed = false;
      ready.then(
        (deps) => {
          if (!closed) cleanup = renderSettings(container, { doc, win, ...deps, loadFailure: () => loadFailure });
        },
        (err) => {
          if (!closed) container.textContent = `Settings could not open: ${describeError(err)}`;
        },
      );
      return () => {
        closed = true;
        cleanup?.();
      };
    },
  });

  ready
    .then(async ({ settings, limits }) => {
      await whenChatShown(doc, win);
      await limits.pruneHistory(await settings.get('retentionDays'));
      await limits.pruneGallery(await settings.get('galleryLimitMB'));
    })
    .catch((err) => {
      loadFailure = describeError(err);
      console.error('TDF Chat 2.0 settings: the storage limits did not run:', err);
    });
}

/**
 * Resolves once the message view (#tdf-chat) exists; bootstrap replays it in the same task
 * that mounts it.
 * @param {Document} doc
 * @param {Window & typeof globalThis} win
 * @returns {Promise<void>}
 */
function whenChatShown(doc, win) {
  return new Promise((resolve) => {
    if (doc.getElementById('tdf-chat')) return resolve();
    const observer = new win.MutationObserver(() => {
      if (!doc.getElementById('tdf-chat')) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(doc.body, { childList: true, subtree: true });
  });
}
