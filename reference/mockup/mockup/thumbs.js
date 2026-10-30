// Gallery storage (harness only), in its own IndexedDB (`harness-thumbs`) rather than the
// overlay's `images` store, whose record shape is not decided yet.
//  - thumbs: url -> 128x128 WebP blob. Each image is decoded once, drawn centre-cropped
//    onto a canvas and stored; later opens read the blob and never touch the full image.
//  - meta:   url -> { favorite, deleted }. A deleted image's thumbnail is dropped and the
//    gallery skips it. The originals stay where they are (the served folder): in the
//    product the original lives in browser storage and is deleted with the rest.
window.__thumbs = (function () {
  var SIZE = 128;
  var DB = 'harness-thumbs';

  var dbp = new Promise(function (resolve, reject) {
    var req = indexedDB.open(DB, 2);
    req.onupgradeneeded = function (e) {
      if (e.oldVersion < 1) req.result.createObjectStore('thumbs');
      if (e.oldVersion < 2) req.result.createObjectStore('meta');
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });

  function tx(store, mode, fn) {
    return dbp.then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, mode);
        var req = fn(t.objectStore(store));
        t.oncomplete = function () { resolve(req && req.result); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  /** Centre-crop to a square, scale to SIZE x SIZE, encode as WebP. */
  function make(url) {
    return fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error(r.status + ' ' + url);
        return r.blob();
      })
      .then(function (blob) { return createImageBitmap(blob); })
      .then(function (bmp) {
        var side = Math.min(bmp.width, bmp.height);
        var canvas = new OffscreenCanvas(SIZE, SIZE);
        var ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
        bmp.close();
        return canvas.convertToBlob({ type: 'image/webp', quality: 0.82 });
      });
  }

  function meta(url) {
    return tx('meta', 'readonly', function (s) { return s.get(url); }).then(function (m) {
      return m || { favorite: false, deleted: false };
    });
  }

  function setMeta(url, patch) {
    return meta(url).then(function (m) {
      var next = Object.assign({}, m, patch);
      return tx('meta', 'readwrite', function (s) { return s.put(next, url); }).then(function () { return next; });
    });
  }

  return {
    SIZE: SIZE,
    /** The stored thumbnail for `url`, made and stored first when there is none. */
    get: function (url) {
      return tx('thumbs', 'readonly', function (s) { return s.get(url); }).then(function (hit) {
        if (hit) return hit;
        return make(url).then(function (blob) {
          return tx('thumbs', 'readwrite', function (s) { return s.put(blob, url); }).then(function () { return blob; });
        });
      });
    },
    meta: meta,
    setFavorite: function (url, favorite) { return setMeta(url, { favorite: favorite }); },
    /** Permanently remove `url`. Refused while it is a favourite. */
    remove: function (url) {
      return meta(url).then(function (m) {
        if (m.favorite) throw new Error('a favourite cannot be deleted; un-star it first');
        return tx('thumbs', 'readwrite', function (s) { return s.delete(url); }).then(function () {
          return setMeta(url, { deleted: true });
        });
      });
    },
    /** Total bytes of the stored thumbnails. */
    thumbBytes: function () {
      return tx('thumbs', 'readonly', function (s) { return s.getAll(); }).then(function (blobs) {
        return blobs.reduce(function (n, b) { return n + b.size; }, 0);
      });
    },
    /** Harness reset: bring back deleted images and drop every stored thumbnail. */
    reset: function () {
      return tx('meta', 'readwrite', function (s) { return s.clear(); }).then(function () {
        return tx('thumbs', 'readwrite', function (s) { return s.clear(); });
      });
    },
  };
})();
