// Smilies (harness only). The engine's icon row is replaced by one outline smiley button
// in its place; it opens a small picker of the engine's own smilies (mySmilies,
// mySmiliesImg in settings.js.php) that inserts the code with the engine's addsmiley().
// The same picker, opened at the pointer, serves image reactions (reactions.js).
window.__smilies = (function () {
  var codes = (window.mySmilies || []).filter(Boolean);
  var imgs = (window.mySmiliesImg || []).slice(0, codes.length);

  /** { code, src } for each smilie, from the engine's markup. */
  var list = codes.map(function (code, i) {
    var m = /src=['"]([^'"]+)['"]/.exec(imgs[i] || '');
    return { code: code, src: m ? m[1] : '' };
  });

  var picker = document.createElement('div');
  picker.className = 'sm-picker';
  picker.hidden = true;
  list.forEach(function (s) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'sm-item';
    b.title = s.code;
    b.dataset.code = s.code;
    b.innerHTML = '<img alt="">';
    b.querySelector('img').src = s.src;
    picker.appendChild(b);
  });
  document.body.appendChild(picker);

  var onPick = null;
  var extra = document.createElement('div');
  extra.className = 'sm-extra';
  picker.appendChild(extra);

  /**
   * Open the picker with its bottom-left at (x, y), or its top-left when `below`.
   * `pick(code, src)` runs on a choice; `actions` adds rows under the grid.
   */
  function open(x, y, pick, opts) {
    opts = opts || {};
    onPick = pick;
    extra.textContent = '';
    (opts.actions || []).forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'sm-action';
      b.textContent = a.label;
      b.addEventListener('click', function () { close(); a.run(); });
      extra.appendChild(b);
    });
    picker.hidden = false;
    var r = picker.getBoundingClientRect();
    var left = Math.min(Math.max(8, x), window.innerWidth - r.width - 8);
    var top = opts.below ? y : y - r.height;
    top = Math.min(Math.max(8, top), window.innerHeight - r.height - 8);
    picker.style.left = left + window.scrollX + 'px';
    picker.style.top = top + window.scrollY + 'px';
  }

  function close() {
    picker.hidden = true;
    onPick = null;
  }

  picker.addEventListener('click', function (e) {
    var item = e.target.closest('.sm-item');
    if (!item || !onPick) return;
    var pick = onPick;
    var s = list.filter(function (x) { return x.code === item.dataset.code; })[0];
    close();
    pick(s.code, s.src);
  });
  document.addEventListener('mousedown', function (e) {
    if (!picker.hidden && !picker.contains(e.target) && !e.target.closest('.sm-button')) close();
  }, true);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });

  // The composer's smiley button, where the engine's icon row was.
  var icons = document.getElementById('optionsIcons');
  var bar = document.getElementById('optionsBar');
  if (icons && bar) {
    icons.style.display = 'none';
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'sm-button';
    button.title = 'Smilies';
    button.setAttribute('aria-label', 'Smilies');
    button.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M8 14.5s1.5 2 4 2 4-2 4-2"/><path d="M9 9.5h.01M15 9.5h.01" stroke-width="3"/></svg>';
    icons.parentElement.appendChild(button);
    button.addEventListener('click', function () {
      if (!picker.hidden) return close();
      var r = button.getBoundingClientRect();
      open(r.left, r.top - 6, function (code) {
        if (typeof window.addsmiley === 'function') window.addsmiley('optionsBar', code);
      });
    });
  }

  return { list: list, open: open, close: close };
})();
