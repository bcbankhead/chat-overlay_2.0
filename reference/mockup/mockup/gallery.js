// Gallery flyout (harness only). A sticky header with the image count, size on disk and a
// star toggle that filters to favourites, then a 3-column grid of 128x128 thumbnails. Each tile has a
// star (favourite: protected from deletion, kept by the filter) and a trash can (deletes
// permanently, disabled while starred). Storage is thumbs.js; the panel's open/close and
// slide are the sidebar's.
window.__galleryFlyout = function () {
  var ICONS = {
    star:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.2l2.7 5.5 6 .9-4.4 4.2 1 6-5.3-2.8-5.3 2.8 1-6L3.3 9.6l6-.9z"/></svg>',
    trash:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  };

  var panel = document.createElement('div');
  panel.className = 'side-flyout side-gallery';
  panel.addEventListener('transitionend', function (e) {
    if (e.target === panel && e.propertyName === 'transform' && panel.classList.contains('open')) {
      panel.classList.add('settled');
    }
  });
  panel.innerHTML =
    '<div class="g-head">' +
    '<span class="g-title">Gallery</span>' +
    '<span class="g-stats"></span>' +
    '<button type="button" class="g-favfilter" aria-pressed="false" title="Show favourites only">' +
    ICONS.star +
    '</button></div>' +
    '<div class="side-grid"></div>' +
    '<div class="side-empty g-none" hidden></div>';
  var grid = panel.querySelector('.side-grid');
  var stats = panel.querySelector('.g-stats');
  var none = panel.querySelector('.g-none');

  /** url -> { tile, size, meta } for every image not deleted. */
  var items = new Map();
  var favOnly = false;

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function refreshStats() {
    var originals = 0, favs = 0;
    items.forEach(function (it) {
      originals += it.size;
      if (it.meta.favorite) favs++;
    });
    window.__thumbs.thumbBytes().then(function (thumbs) {
      stats.textContent = items.size + ' images · ' + formatBytes(originals + thumbs);
      stats.title =
        'Originals ' + formatBytes(originals) + ' + thumbnails ' + formatBytes(thumbs) + ' · ' + favs + ' favourites';
    });
    applyFilter();
  }

  function applyFilter() {
    var shown = 0;
    items.forEach(function (it) {
      var show = !favOnly || it.meta.favorite;
      it.tile.hidden = !show;
      if (show) shown++;
    });
    none.hidden = shown > 0;
    none.textContent = favOnly ? 'No favourites yet. Star an image to keep it here.' : 'No images yet';
  }

  function paintTile(it) {
    it.tile.classList.toggle('fav', it.meta.favorite);
    var star = it.tile.querySelector('.g-star');
    star.setAttribute('aria-pressed', String(it.meta.favorite));
    star.title = it.meta.favorite ? 'Un-star' : 'Star (favourite, protected from deletion)';
    var trash = it.tile.querySelector('.g-trash');
    trash.disabled = it.meta.favorite;
    trash.title = it.meta.favorite ? 'Starred images cannot be deleted' : 'Delete permanently';
  }

  function tileFor(url, i) {
    var tile = document.createElement('div');
    tile.className = 'g-tile';
    tile.style.setProperty('--i', String(i)); // stagger order for the fade-in
    tile.innerHTML =
      '<img class="side-thumb" alt="">' +
      '<button type="button" class="g-btn g-star">' + ICONS.star + '</button>' +
      '<button type="button" class="g-btn g-trash">' + ICONS.trash + '</button>';
    var img = tile.querySelector('img');
    img.addEventListener('load', function () { img.classList.add('ready'); });
    return tile;
  }

  panel.addEventListener('click', function (e) {
    var toggle = e.target.closest('.g-favfilter');
    if (toggle) {
      favOnly = !favOnly;
      toggle.setAttribute('aria-pressed', String(favOnly));
      toggle.title = favOnly ? 'Show all images' : 'Show favourites only';
      applyFilter();
      return;
    }
    var btn = e.target.closest('.g-btn');
    if (!btn) return;
    var url = btn.closest('.g-tile').dataset.url;
    var it = items.get(url);
    if (btn.classList.contains('g-star')) {
      window.__thumbs.setFavorite(url, !it.meta.favorite).then(function (m) {
        it.meta = m;
        paintTile(it);
        refreshStats();
      });
    } else if (!btn.disabled) {
      removeItem(url);
    }
  });

  /** Permanently remove one image (refused by storage while it is a favourite). */
  function removeItem(url) {
    var it = items.get(url);
    if (!it) return Promise.resolve(false);
    it.tile.classList.add('removing');
    return window.__thumbs.remove(url).then(function () {
      items.delete(url);
      setTimeout(function () {
        it.tile.remove();
        refreshStats();
      }, 180);
      return true;
    }, function (err) {
      it.tile.classList.remove('removing');
      console.error(err);
      return false;
    });
  }

  function totalBytes() {
    var n = 0;
    items.forEach(function (it) { n += it.size; });
    return n;
  }

  /**
   * The oldest non-favourite images that must go for the gallery to fit `limit` bytes,
   * oldest first. Favourites are never chosen, so the gallery can stay over the limit.
   */
  function overLimit(limit) {
    var excess = totalBytes() - limit;
    var picked = [];
    if (!(limit > 0) || excess <= 0) return picked;
    var byAge = Array.from(items.entries())
      .filter(function (e) { return !e[1].meta.favorite; })
      .sort(function (a, b) { return a[1].mtime - b[1].mtime || (a[0] < b[0] ? -1 : 1); });
    for (var i = 0; i < byAge.length && excess > 0; i++) {
      picked.push(byAge[i][0]);
      excess -= byAge[i][1].size;
    }
    return picked;
  }

  var ready;
  var loaded = new Promise(function (resolve) { ready = resolve; });
  window.__gallery = {
    loaded: loaded,
    totalBytes: totalBytes,
    /** What enforcing `limit` would remove: { count, bytes }. */
    preview: function (limit) {
      var urls = overLimit(limit);
      return {
        count: urls.length,
        bytes: urls.reduce(function (n, u) { return n + items.get(u).size; }, 0),
      };
    },
    /** Remove the oldest non-favourites until the gallery fits `limit` bytes. */
    enforce: function (limit) {
      return Promise.all(overLimit(limit).map(removeItem)).then(function (r) {
        return r.filter(Boolean).length;
      });
    },
  };

  fetch('/gallery/index.json')
    .then(function (r) { return r.json(); })
    .then(function (list) {
      return Promise.all(list.map(function (entry) {
        return window.__thumbs.meta(entry.url).then(function (m) { return { entry: entry, meta: m }; });
      }));
    })
    .then(function (rows) {
      rows = rows.filter(function (r) { return !r.meta.deleted; });
      rows.forEach(function (r, i) {
        var tile = tileFor(r.entry.url, i);
        tile.dataset.url = r.entry.url;
        grid.appendChild(tile);
        var it = { tile: tile, size: r.entry.size, mtime: r.entry.mtime || 0, meta: r.meta };
        items.set(r.entry.url, it);
        paintTile(it);
      });
      refreshStats();
      ready();

      // A few at a time: a missing thumbnail means decoding a full-size image.
      var queue = rows.map(function (r) { return r.entry.url; });
      function work() {
        var url = queue.shift();
        if (!url) return Promise.resolve();
        return window.__thumbs.get(url).then(function (blob) {
          var it = items.get(url);
          if (it) it.tile.querySelector('img').src = URL.createObjectURL(blob);
        }, function (err) {
          console.error('thumbnail failed', url, err);
        }).then(function () {
          if (queue.length === 0) refreshStats(); // thumbnail bytes are final now
          return work();
        });
      }
      for (var i = 0; i < 4; i++) work();
    });

  return panel;
};
