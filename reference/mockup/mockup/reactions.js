// Image reactions (harness only). Clicking an image in a message opens the smiley picker
// at the pointer (smilies.js); a choice adds your reaction under the image as a chip with
// a count, and choosing the same smiley again takes yours back. "Open full size" keeps
// the old click behaviour.
//
// Reactions live only in this page: how they reach other users (a message the engine
// carries, or our own channel) is not decided, and the engine has no reactions of its own.
(function () {
  var me = decodeURI(String(window.userName || ''));
  /** message element -> Map(code -> { src, users: Set }) */
  var reactions = new WeakMap();

  /** An image someone posted, not a smilie or avatar inside the text. */
  function postedImage(el) {
    if (!(el instanceof HTMLImageElement) || !el.closest('#tdf-chat .tdf-body')) return false;
    if (/(^|\/)smilies\//.test(el.getAttribute('src') || '')) return false;
    return el.naturalWidth > 48 || el.naturalHeight > 48;
  }

  // Posted images are tagged `rx-img` once loaded (their size decides), so the stylesheet
  // can give them a pointer and a hover state without catching smilies.
  function tag(img) {
    if (postedImage(img)) img.classList.add('rx-img');
  }
  document.addEventListener('load', function (e) {
    if (e.target instanceof HTMLImageElement) tag(e.target);
  }, true);
  document.querySelectorAll('#tdf-chat .tdf-body img').forEach(function (img) {
    if (img.complete) tag(img);
  });

  function render(msg) {
    var map = reactions.get(msg);
    var row = msg.querySelector(':scope > .rx-row');
    if (!map || map.size === 0) {
      if (row) row.remove();
      return;
    }
    if (!row) {
      row = document.createElement('div');
      row.className = 'rx-row';
      msg.appendChild(row);
    }
    row.textContent = '';
    map.forEach(function (r, code) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'rx-chip' + (r.users.has(me) ? ' mine' : '');
      chip.title = Array.from(r.users).join(', ');
      chip.dataset.code = code;
      chip.innerHTML = '<img alt=""><span></span>';
      chip.querySelector('img').src = r.src;
      chip.querySelector('span').textContent = String(r.users.size);
      row.appendChild(chip);
    });
  }

  function toggle(msg, code, src) {
    var map = reactions.get(msg) || new Map();
    reactions.set(msg, map);
    var r = map.get(code) || { src: src, users: new Set() };
    if (r.users.has(me)) r.users.delete(me);
    else r.users.add(me);
    if (r.users.size) map.set(code, r);
    else map.delete(code);
    render(msg);
  }

  document.addEventListener('click', function (e) {
    var chip = e.target.closest && e.target.closest('#tdf-chat .rx-chip');
    if (chip) {
      var r = reactions.get(chip.closest('.tdf-msg')).get(chip.dataset.code);
      toggle(chip.closest('.tdf-msg'), chip.dataset.code, r.src);
      return;
    }
    if (!postedImage(e.target)) return;
    e.preventDefault(); // the image's link no longer opens on a plain click
    var img = e.target;
    var msg = img.closest('.tdf-msg');
    var link = img.closest('a');
    var full = link ? link.href : img.src;
    window.__smilies.open(e.clientX, e.clientY + 8, function (code, src) {
      toggle(msg, code, src);
    }, {
      below: true,
      actions: [{ label: 'Open full size', run: function () { window.open(full, '_blank', 'noopener'); } }],
    });
  }, true);
})();
