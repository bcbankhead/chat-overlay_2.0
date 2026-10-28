// Message layout mockup (harness only): avatar + grouped. Decorates the overlay's own
// rendered .tdf-msg rows without changing them: a run of public messages from one sender
// gets one header (avatar, name, time) and the rest of the run is indented beneath it;
// join/leave and system notices become small muted lines. Follows rows as they are added.
(function () {
  /** Messages further apart than this start a new group even from the same sender. */
  var GROUP_GAP_S = 5 * 60;

  /** Sender name → avatar src, from the engine's user list and its (hidden) messages. */
  function avatarMap() {
    var map = {};
    document.querySelectorAll('#userContainer .userlist').forEach(function (row) {
      var img = row.querySelector('img');
      var label = row.querySelector('span[onclick]');
      if (img && label) map[label.textContent] = img.getAttribute('src');
    });
    document.querySelectorAll('#chatContainer > .chatMessage').forEach(function (div) {
      var img = div.querySelector(':scope > img');
      var name = div.querySelector('#username');
      var m = name && /whisperUser\("([^"]+)"\)/.exec(name.getAttribute('onclick') || '');
      if (img && m && !map[m[1]]) map[m[1]] = img.getAttribute('src');
    });
    return map;
  }

  function senderOf(msg) {
    var u = msg.querySelector('.tdf-user');
    return u ? decodeURIComponent(u.dataset.user || u.textContent) : '';
  }

  function timeOf(msg) {
    var t = Number(msg.dataset.mtime);
    return t > 0 ? t : null;
  }

  function clock(seconds) {
    var d = new Date(seconds * 1000);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function isChat(msg) {
    return msg.classList.contains('tdf-kind-public') || msg.classList.contains('tdf-kind-whisper');
  }

  function decorate(list) {
    var avatars = avatarMap();
    var prev = null;
    list.querySelectorAll(':scope > .tdf-msg').forEach(function (msg) {
      if (!isChat(msg)) {
        msg.classList.add('m-notice');
        prev = null;
        return;
      }
      var user = senderOf(msg);
      var t = timeOf(msg);
      var cont =
        prev !== null &&
        prev.user === user &&
        (t === null || prev.t === null || t - prev.t <= GROUP_GAP_S);
      msg.classList.toggle('m-cont', cont);
      msg.classList.toggle('m-head', !cont);

      if (!cont && !msg.querySelector(':scope > .m-avatar')) {
        var img = document.createElement('img');
        img.className = 'm-avatar';
        img.alt = '';
        if (avatars[user]) img.src = avatars[user];
        msg.prepend(img);
        var name = msg.querySelector('.tdf-user');
        if (name && t !== null && !msg.querySelector('.m-time')) {
          var time = document.createElement('span');
          time.className = 'm-time';
          time.textContent = clock(t);
          name.after(time);
        }
      }
      prev = { user: user, t: t === null ? (prev && prev.user === user ? prev.t : null) : t };
    });
  }

  /**
   * The theme's background, as a colour. Read from the --tdf-bg token, not the computed
   * background-color: during the theme cross-fade (sidebar.css .theme-fading) the
   * background is still easing from the old theme, while a custom property takes its new
   * value at once.
   */
  function themeBackground(el) {
    var cs = getComputedStyle(el);
    return cs.getPropertyValue('--tdf-bg').trim() || cs.backgroundColor;
  }

  /** Show each sender colour adapted to the current theme's background (ink.js). */
  function recolour(list) {
    var chat = list.closest('#tdf-chat');
    var bg = themeBackground(chat);
    list.querySelectorAll(':scope > .tdf-msg .tdf-line').forEach(function (line) {
      if (line.dataset.color === undefined) line.dataset.color = line.style.color;
      // Notices are the view's own voice: muted theme text, never a sender colour.
      if (line.closest('.m-notice')) {
        line.style.color = '';
        return;
      }
      if (!line.dataset.color) return;
      line.style.color = window.__ink.adapt(line.dataset.color, bg);
    });
  }

  /**
   * The message box shows your colour adapted to the theme, as messages do. Your colour is
   * the engine's own textColor, never read back from the box (which shows the adapted
   * one). The theme is the message view's: the box's copies of its tokens are refreshed by
   * the composer after a switch, so they can still hold the old theme when this runs.
   */
  function recolourBar() {
    var bar = document.getElementById('optionsBar');
    var chat = document.getElementById('tdf-chat');
    var chosen = window.textColor;
    if (!bar || !chat || !chosen) return;
    // A grey with no contrast takes the theme's text colour. Messages inherit it from the
    // view; the box is outside the view, so it is given it explicitly.
    var next = window.__ink.adapt(chosen, themeBackground(chat)) ||
      getComputedStyle(chat).getPropertyValue('--tdf-fg').trim();
    if (bar.style.color === next) return;
    bar.style.color = next;
    bar.dataset.shown = bar.style.color; // normalised, as the browser reports it back
  }

  /** The engine restyles the box from textColor (changeMessBoxStyle); adapt after it. */
  function watchBar() {
    var bar = document.getElementById('optionsBar');
    if (!bar) return;
    recolourBar();
    new MutationObserver(function () {
      if (bar.style.color !== bar.dataset.shown) recolourBar();
    }).observe(bar, { attributes: true, attributeFilter: ['style'] });
  }

  function attach(list) {
    decorate(list);
    recolour(list);
    watchBar();
    new MutationObserver(function () {
      decorate(list);
      recolour(list);
    }).observe(list, { childList: true });
    // The background changes with the theme; recolour once the new tokens apply.
    new MutationObserver(function () {
      recolour(list);
      recolourBar();
    }).observe(list.closest('#tdf-chat'), {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  }

  var list = document.querySelector('#tdf-chat .tdf-list');
  if (list) return attach(list);
  var wait = new MutationObserver(function () {
    var found = document.querySelector('#tdf-chat .tdf-list');
    if (!found) return;
    wait.disconnect();
    attach(found);
  });
  wait.observe(document.body, { childList: true, subtree: true });
})();
