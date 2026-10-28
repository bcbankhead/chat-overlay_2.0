// Text style section (harness only), shown in the profile flyout: font face and colour
// for your own messages. The choices are the engine's own lists (myFontFamily, myColor in
// settings.js.php) and go to the engine's own state (textFamily, textColor), applied to
// the message box with changeMessBoxStyle() as its Text Options menu does. The engine's
// addFontFamily()/addColor() are not called: both also write its #fontsizeWin preview,
// which only exists once its own menu has been opened.
window.__textStyleSection = function () {
  var section = document.createElement('div');
  section.className = 'st-block';
  section.innerHTML =
    '<div class="st-title">Text style</div>' +
    '<div class="st-preview">Your messages will look like this</div>' +
    // Font and colour fold away, closed by default; each header shows the current choice.
    '<details class="st-acc"><summary><span>Font</span><span class="st-now st-now-font"></span></summary>' +
    '<div class="st-fonts"></div></details>' +
    '<details class="st-acc"><summary><span>Colour</span><span class="st-now st-now-color"></span></summary>' +
    '<div class="st-colors"></div></details>';

  var fonts = (window.myFontFamily || []).filter(Boolean);
  var colors = (window.myColor || []).filter(Boolean);
  var preview = section.querySelector('.st-preview');

  fonts.forEach(function (f) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'st-font';
    b.dataset.font = f;
    b.style.fontFamily = f;
    b.textContent = f;
    section.querySelector('.st-fonts').appendChild(b);
  });
  colors.forEach(function (c) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'st-color';
    b.dataset.color = c;
    b.title = c;
    b.style.background = c;
    section.querySelector('.st-colors').appendChild(b);
  });

  function paint() {
    var font = window.textFamily, color = window.textColor;
    var nowFont = section.querySelector('.st-now-font');
    nowFont.textContent = font || '';
    nowFont.style.fontFamily = font || '';
    var nowColor = section.querySelector('.st-now-color');
    nowColor.style.background = color || 'transparent';
    nowColor.title = color || '';
    preview.style.fontFamily = font || '';
    preview.style.color = color || '';
    section.querySelectorAll('.st-font').forEach(function (b) {
      b.classList.toggle('on', String(b.dataset.font).toLowerCase() === String(font).toLowerCase());
    });
    section.querySelectorAll('.st-color').forEach(function (b) {
      b.classList.toggle('on', String(b.dataset.color).toLowerCase() === String(color).toLowerCase());
    });
  }

  section.addEventListener('click', function (e) {
    var f = e.target.closest('.st-font');
    var c = e.target.closest('.st-color');
    if (!f && !c) return;
    if (f) window.textFamily = f.dataset.font;
    if (c) window.textColor = c.dataset.color;
    if (typeof window.changeMessBoxStyle === 'function') window.changeMessBoxStyle('optionsBar');
    paint();
  });

  paint();
  return section;
};

// Gear flyout (harness only): auto-scroll, clearing the chat buffer, and the storage limits
// (limits.js) for chat history and the gallery.
window.__styleFlyout = function () {
  var panel = document.createElement('div');
  panel.className = 'side-flyout side-style';
  panel.addEventListener('transitionend', function (e) {
    if (e.target === panel && e.propertyName === 'transform' && panel.classList.contains('open')) {
      panel.classList.add('settled');
    }
  });
  panel.innerHTML =
    '<div class="st-title">Settings</div>' +
    '<div class="st-section st-first">Chat</div>' +
    '<label class="p-row"><span>Auto-scroll</span>' +
    '<input type="checkbox" class="p-switch st-autoscroll"></label>' +
    '<button type="button" class="st-clear">Clear chat buffer</button>' +
    '<div class="st-hint">Empties the message view. Saved history is kept and returns on reload.</div>' +
    '<div class="st-section">Storage</div>' +
    '<label class="st-field"><span>Chat history (days)</span>' +
    '<input type="number" class="st-history" min="0" step="1" inputmode="numeric"></label>' +
    '<div class="st-hint st-history-hint"></div>' +
    '<label class="st-field"><span>Gallery size limit (MB)</span>' +
    '<input type="number" class="st-gallery" min="1" step="1" inputmode="numeric" placeholder="No limit"></label>' +
    '<div class="st-hint st-gallery-hint"></div>';

  // Auto-scroll: a switch over the engine's #autoScrollID, both ways.
  var engineScroll = document.getElementById('autoScrollID');
  var sw = panel.querySelector('.st-autoscroll');
  if (engineScroll) {
    sw.checked = engineScroll.checked;
    sw.addEventListener('change', function () {
      engineScroll.checked = sw.checked;
      engineScroll.dispatchEvent(new Event('change', { bubbles: true }));
    });
    engineScroll.addEventListener('change', function () { sw.checked = engineScroll.checked; });
  }

  // Clear chat buffer: the engine's own clrScreen() (its hidden view), then the overlay's
  // rendered messages. The scrollbar thumb living in the list is left in place.
  panel.querySelector('.st-clear').addEventListener('click', function () {
    if (typeof window.clrScreen === 'function') window.clrScreen();
    document.querySelectorAll('#tdf-chat .tdf-list > .tdf-msg').forEach(function (m) { m.remove(); });
  });

  // Storage limits. The hint under each field says what the typed value would delete;
  // the deletion runs when the value is committed (Enter or leaving the field).
  var history = panel.querySelector('.st-history');
  var historyHint = panel.querySelector('.st-history-hint');
  var gallery = panel.querySelector('.st-gallery');
  var galleryHint = panel.querySelector('.st-gallery-hint');
  var limits = window.__limits.get();
  history.value = String(limits.historyDays);
  gallery.value = limits.galleryMB ? String(limits.galleryMB) : '';

  function days() {
    var n = Math.floor(Number(history.value));
    return n >= 0 ? n : null;
  }

  function megabytes() {
    if (gallery.value.trim() === '') return null;
    var n = Math.floor(Number(gallery.value));
    return n >= 1 ? n : NaN;
  }

  function hintHistory() {
    var d = days();
    if (d === null) {
      historyHint.textContent = 'Enter 0 or more days.';
      return;
    }
    window.__limits.previewHistory(d).then(function (n) {
      var base = d === 0 ? 'No chat history is kept.' : 'Lines older than ' + d + ' day' + (d === 1 ? '' : 's') + ' are deleted, oldest first.';
      historyHint.textContent = base + (n ? ' This removes ' + n + ' line' + (n === 1 ? '' : 's') + ' now.' : '');
      historyHint.classList.toggle('warn', n > 0);
    });
  }

  function hintGallery() {
    var mb = megabytes();
    if (Number.isNaN(mb)) {
      galleryHint.textContent = 'Enter 1 MB or more, or leave empty for no limit.';
      return;
    }
    window.__gallery.loaded.then(function () {
      var used = (window.__gallery.totalBytes() / 1048576).toFixed(1) + ' MB used';
      if (mb === null) {
        galleryHint.textContent = 'No limit. ' + used + '.';
        galleryHint.classList.remove('warn');
        return;
      }
      var p = window.__gallery.preview(mb * 1048576);
      galleryHint.textContent = used + '. Oldest images go first; favourites are kept.' +
        (p.count ? ' This removes ' + p.count + ' image' + (p.count === 1 ? '' : 's') + ' (' + (p.bytes / 1048576).toFixed(1) + ' MB) now.' : '');
      galleryHint.classList.toggle('warn', p.count > 0);
    });
  }

  history.addEventListener('input', hintHistory);
  gallery.addEventListener('input', hintGallery);
  history.addEventListener('change', function () {
    var d = days();
    if (d === null) return;
    window.__limits.set({ historyDays: d });
    window.__limits.pruneHistory(d).then(hintHistory);
  });
  gallery.addEventListener('change', function () {
    var mb = megabytes();
    if (Number.isNaN(mb)) return;
    window.__limits.set({ galleryMB: mb });
    if (mb === null) return hintGallery();
    window.__gallery.enforce(mb * 1048576).then(function () { setTimeout(hintGallery, 250); });
  });
  hintHistory();
  hintGallery();
  // A stored gallery limit holds on every load, as the history limit does (offline.js).
  if (limits.galleryMB) {
    window.__gallery.loaded.then(function () {
      return window.__gallery.enforce(limits.galleryMB * 1048576);
    }).then(hintGallery);
  }

  return panel;
};
