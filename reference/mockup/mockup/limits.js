// Storage limits (harness only), set from the gear flyout and kept per browser:
//  - historyDays: chat history is kept this many days; older lines are deleted, oldest
//    first. 0 keeps no history at all.
//  - galleryMB:   the gallery is kept under this size by deleting the oldest images
//    first, favourites never. Empty means no limit.
// History is pruned in the overlay's own IndexedDB (`tdf-chat-2`, store `messages`, by
// receivedAt) on load and whenever the setting changes. The overlay itself still stores
// every message it receives: in the product the limit belongs in its history module.
window.__limits = (function () {
  var KEY = 'harness:limits';
  var DEFAULTS = { historyDays: 30, galleryMB: null };
  var DAY_MS = 24 * 60 * 60 * 1000;

  function get() {
    try {
      return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}'));
    } catch (e) {
      return Object.assign({}, DEFAULTS);
    }
  }

  function set(patch) {
    var next = Object.assign(get(), patch);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) { /* kept for this page only */ }
    return next;
  }

  function openHistory() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('tdf-chat-2');
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  /** Ids of history lines older than `days` (every line when days is 0). */
  function expired(days) {
    var cutoff = days > 0 ? Date.now() - days * DAY_MS : Infinity;
    return openHistory().then(function (db) {
      if (!db.objectStoreNames.contains('messages')) {
        db.close();
        return [];
      }
      return new Promise(function (resolve, reject) {
        var ids = [];
        var t = db.transaction('messages', 'readonly');
        var range = IDBKeyRange.upperBound(cutoff, true);
        var cur = t.objectStore('messages').index('receivedAt').openCursor(days > 0 ? range : null);
        cur.onsuccess = function () {
          var c = cur.result;
          if (!c) return;
          ids.push(c.primaryKey);
          c.continue();
        };
        t.oncomplete = function () { db.close(); resolve(ids); };
        t.onerror = function () { db.close(); reject(t.error); };
      });
    });
  }

  /** Delete history lines older than the setting; also drops them from the open view. */
  function pruneHistory(days) {
    if (days === undefined) days = get().historyDays;
    return expired(days).then(function (ids) {
      if (ids.length === 0) return 0;
      return openHistory().then(function (db) {
        return new Promise(function (resolve, reject) {
          var t = db.transaction('messages', 'readwrite');
          var store = t.objectStore('messages');
          ids.forEach(function (id) { store.delete(id); });
          t.oncomplete = function () { db.close(); resolve(ids.length); };
          t.onerror = function () { db.close(); reject(t.error); };
        });
      }).then(function (n) {
        ids.forEach(function (id) {
          var el = document.querySelector('#tdf-chat .tdf-msg[data-id="' + CSS.escape(String(id)) + '"]');
          if (el) el.remove();
        });
        return n;
      });
    });
  }

  return {
    get: get,
    set: set,
    /** How many history lines `days` would delete. */
    previewHistory: function (days) { return expired(days).then(function (ids) { return ids.length; }); },
    pruneHistory: pruneHistory,
  };
})();
