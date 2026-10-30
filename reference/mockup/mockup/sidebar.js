// Sidebar mockup (harness only, not repo code). Reads the engine's own #userContainer —
// rooms, counts and user rows — and redraws it as: gallery and profile icons, the
// current room as an open chip-accordion holding its users, and the other rooms as
// collapsed chip-accordions at the bottom. Re-renders when the engine changes the list.
(function () {
  var engine = document.getElementById('userContainer');
  if (!engine) return;

  var ICONS = {
    gallery:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/></svg>',
    profile:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    gear:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    sun:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    logout:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
    caret:
      '<svg class="side-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  };

  // Room creation is unused, so the engine's room icon, create form and room dropdown go.
  // Their row sat above the user list; the sidebar grows up into it. Read it before hiding.
  var iconRow = document.getElementById('roomIcon');
  var topEdge = iconRow ? iconRow.getBoundingClientRect().top : null;
  ['roomIcon', 'roomCreate', 'roomSelect'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  var side = document.createElement('div');
  side.id = 'tdf-side';
  document.body.appendChild(side);
  // render() rebuilds `content` only; flyouts are siblings that survive a re-render.
  var content = document.createElement('div');
  content.className = 'side-content';
  side.appendChild(content);
  engine.style.visibility = 'hidden';

  /** Which rooms the user has opened or closed, by room id; current is open by default. */
  var openState = {};

  function readRooms() {
    return Array.prototype.map.call(engine.querySelectorAll(':scope > div[id^="room_"]'), function (room) {
      var id = room.id.slice('room_'.length);
      var header = room.querySelector('.roomheader');
      var name = header ? header.querySelector('span').textContent.replace(/ /g, ' ').trim() : id;
      var count = (room.querySelector('#userCount_' + id) || {}).textContent || '0';
      var users = Array.prototype.map.call(room.querySelectorAll('.userlist'), function (row) {
        var img = row.querySelector('img');
        var label = row.querySelector('span[onclick]');
        return { name: label ? label.textContent : '', avatar: img ? img.getAttribute('src') : '' };
      });
      return { id: id, name: name, count: count, users: users };
    });
  }

  function roomEl(room, current) {
    var open = room.id in openState ? openState[room.id] : current;
    var el = document.createElement('section');
    el.className = 'side-room' + (current ? ' side-current' : '') + (open ? ' open' : '');

    var chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'side-chip';
    chip.innerHTML = '<span class="side-name"></span><span class="side-count"></span>' + ICONS.caret;
    chip.querySelector('.side-name').textContent = room.name;
    chip.querySelector('.side-count').textContent = room.count;
    chip.addEventListener('click', function () {
      openState[room.id] = !el.classList.contains('open');
      el.classList.toggle('open', openState[room.id]);
    });
    el.appendChild(chip);

    var list = document.createElement('ul');
    list.className = 'side-users';
    if (room.users.length === 0) {
      var empty = document.createElement('li');
      empty.className = 'side-empty';
      empty.textContent = 'Nobody here';
      list.appendChild(empty);
    }
    room.users.forEach(function (u) {
      var li = document.createElement('li');
      li.className = 'side-user';
      li.dataset.name = u.name;
      var img = document.createElement('img');
      img.src = u.avatar;
      img.alt = '';
      var name = document.createElement('span');
      name.textContent = u.name;
      li.appendChild(img);
      li.appendChild(name);
      list.appendChild(li);
    });
    el.appendChild(list);
    return el;
  }

  function render() {
    var rooms = readRooms();
    var currentId = String(window.roomID);
    content.textContent = '';

    var icons = document.createElement('div');
    icons.className = 'side-icons';
    // Gallery, profile and the theme toggle on the left; the gear (settings) anchored
    // right, with the free space as the gap between them.
    [['gallery', 'Gallery'], ['profile', 'Profile'], ['style', 'Settings']].forEach(function (pair) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'side-icon' + (pair[0] === 'style' ? ' side-icon-end' : '');
      b.title = pair[1];
      b.dataset.panel = pair[0];
      b.classList.toggle('active', openPanel === pair[0]);
      b.innerHTML = ICONS[pair[0] === 'style' ? 'gear' : pair[0]];
      icons.appendChild(b);
      if (pair[0] === 'profile') icons.appendChild(themeButton());
    });
    content.appendChild(icons);

    var current = rooms.filter(function (r) { return r.id === currentId; })[0];
    if (current) content.appendChild(roomEl(current, true));

    var others = document.createElement('div');
    others.className = 'side-others';
    rooms.forEach(function (r) {
      if (r.id !== currentId) others.appendChild(roomEl(r, false));
    });
    content.appendChild(others);

    // Logout: an outline button under the last room; it presses the engine's own
    // (hidden) Logout, so logout('0') runs as before.
    var logout = document.createElement('button');
    logout.type = 'button';
    logout.className = 'side-logout';
    logout.innerHTML = ICONS.logout + '<span>Logout</span>';
    logout.addEventListener('click', function () {
      var original = document.getElementById('optionsLogout');
      if (original) original.click();
    });
    content.appendChild(logout);
  }

  /** The overlay's theme, as a two-state light/dark toggle. */
  function currentTheme() {
    var chat = document.getElementById('tdf-chat');
    return (chat && chat.dataset.theme) || 'light';
  }

  function themeButton() {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'side-icon side-theme';
    var dark = currentTheme() === 'dark';
    b.title = dark ? 'Switch to light' : 'Switch to dark';
    b.innerHTML = dark ? ICONS.sun : ICONS.moon;
    b.addEventListener('click', function () {
      // The overlay's own toggle cycles auto -> light -> dark; press it until the
      // resolved theme flips, so its stored setting stays the overlay's to keep.
      var chat = document.getElementById('tdf-chat');
      var toggle = chat && chat.querySelector('.tdf-theme-toggle');
      if (!toggle) return;
      var from = currentTheme();
      // Cross-fade: every colour eases for the length of the switch only (sidebar.css,
      // .theme-fading), so hovers and the flyout slide keep their own timing otherwise.
      var root = document.documentElement;
      root.classList.add('theme-fading');
      clearTimeout(themeButton.fadeTimer);
      themeButton.fadeTimer = setTimeout(function () { root.classList.remove('theme-fading'); }, 450);
      (function press(n) {
        if (n === 0 || currentTheme() !== from) return;
        toggle.click();
        setTimeout(function () { press(n - 1); }, 30);
      })(3);
    });
    return b;
  }

  function place() {
    var r = engine.getBoundingClientRect();
    var top = topEdge !== null && topEdge > 0 && topEdge < r.top ? topEdge : r.top;
    side.style.left = r.left + window.scrollX + 'px';
    side.style.top = top + window.scrollY + 'px';
    side.style.width = r.width + 'px';
    side.style.height = r.bottom - top + 'px';
  }

  function syncTheme() {
    var chat = document.getElementById('tdf-chat');
    var theme = (chat && chat.dataset.theme) || 'light';
    if (side.dataset.theme === theme) return;
    side.dataset.theme = theme;
    var old = content.querySelector('.side-theme');
    if (old) old.replaceWith(themeButton());
  }

  // Flyouts: one open at a time, growing leftward over the message view from the
  // sidebar's left edge. The icon toggles it; Esc or a click outside closes it.
  var openPanel = null;
  var flyouts = {
    gallery: window.__galleryFlyout(),
    profile: window.__profileFlyout(),
    style: window.__styleFlyout(),
  };
  Object.keys(flyouts).forEach(function (k) { side.appendChild(flyouts[k]); });

  // Opening slides the panel out; once that transition ends, `settled` fades its
  // contents in. Closing drops both at once and the panel slides back.
  function setPanel(name) {
    openPanel = openPanel === name ? null : name;
    Object.keys(flyouts).forEach(function (k) {
      var panel = flyouts[k];
      var open = k === openPanel;
      panel.classList.toggle('open', open);
      if (!open) panel.classList.remove('settled');
      // With reduced motion there is no transition, so no transitionend to wait for.
      else if (matchMedia('(prefers-reduced-motion: reduce)').matches) panel.classList.add('settled');
    });
    content.querySelectorAll('.side-icon').forEach(function (b) {
      b.classList.toggle('active', b.dataset.panel === openPanel);
    });
  }

  side.addEventListener('click', function (e) {
    var icon = e.target.closest('.side-icon');
    if (icon && flyouts[icon.dataset.panel]) setPanel(icon.dataset.panel);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && openPanel) setPanel(openPanel);
  });
  // Any press outside the open flyout closes it, the rest of the sidebar included, and
  // that press does nothing else: the click it would make is swallowed, so closing never
  // also toggles a room or presses a button underneath. The icons are left to their own
  // click, which toggles or switches the flyout.
  var swallowClick = false;
  document.addEventListener('mousedown', function (e) {
    if (!openPanel || flyouts[openPanel].contains(e.target)) return;
    var icon = e.target.closest && e.target.closest('#tdf-side .side-icon');
    if (icon && flyouts[icon.dataset.panel]) return;
    setPanel(openPanel);
    e.preventDefault(); // no focus change or text selection either
    swallowClick = true;
  }, true);
  document.addEventListener('click', function (e) {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  // A press that ends without a click (dragged off its target) must not carry the flag
  // over to the next, unrelated click.
  document.addEventListener('mouseup', function () {
    setTimeout(function () { swallowClick = false; }, 0);
  }, true);

  // A user's name opens a small menu at the pointer, on left or right click. It replaces
  // the engine's Whisper To field: Whisper sets the engine's whisper target, and on the
  // user already being whispered to it reads Stop whispering.
  var menu = document.createElement('div');
  menu.className = 'side-menu';
  menu.hidden = true;
  side.appendChild(menu);

  function whisperTarget() {
    var field = document.getElementById('whisperID');
    return field ? field.value : '';
  }

  function openMenu(name, x, y) {
    var self = name.toLowerCase() === decodeURI(String(window.userName || '')).toLowerCase();
    var whispering = whisperTarget() === name;
    menu.innerHTML = '<div class="side-menu-title"></div><button type="button" class="side-menu-item"></button>';
    menu.querySelector('.side-menu-title').textContent = name;
    var item = menu.querySelector('.side-menu-item');
    item.textContent = self ? 'Whisper (that is you)' : whispering ? 'Stop whispering' : 'Whisper';
    item.disabled = self;
    item.onclick = function () {
      if (whispering) window.clearWhisper();
      else window.whisperUser(name);
      closeMenu();
    };
    menu.hidden = false;
    // Open leftward from the pointer, toward the message view as the flyouts do; the
    // sidebar sits at the window's right edge. Kept inside the viewport.
    var r = menu.getBoundingClientRect();
    var left = Math.max(8, x - r.width);
    var top = Math.min(y, window.innerHeight - r.height - 8);
    var s = side.getBoundingClientRect();
    menu.style.left = left - s.left + 'px';
    menu.style.top = top - s.top + 'px';
  }

  function closeMenu() {
    menu.hidden = true;
  }

  function onName(e) {
    var row = e.target.closest('.side-user');
    if (!row) return;
    e.preventDefault();
    openMenu(row.dataset.name, e.clientX, e.clientY);
  }
  side.addEventListener('click', onName);
  side.addEventListener('contextmenu', onName);
  document.addEventListener('mousedown', function (e) {
    if (!menu.hidden && !menu.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeMenu();
  });
  side.addEventListener('scroll', closeMenu, true);

  // The engine's Whisper To, AutoScroll and eCredits move into the sidebar (the menu
  // above, and the profile flyout); the originals stay in the page, hidden, still read
  // by the engine.
  var status = document.querySelector('.optionsSelectStatus');
  if (status) status.style.display = 'none';
  // Logout moves to the sidebar, the light/dark toggle to the icon row.
  var engineLogout = document.getElementById('optionsLogout');
  if (engineLogout) engineLogout.style.display = 'none';

  render();
  place();
  syncTheme();
  window.addEventListener('resize', place);
  new MutationObserver(render).observe(engine, { childList: true, subtree: true, characterData: true });
  // The overlay mounts asynchronously and can re-theme at any time; follow both.
  new MutationObserver(syncTheme).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-theme'],
  });
})();
