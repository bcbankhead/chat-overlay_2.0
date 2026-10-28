// Seeds the overlay's local history (IndexedDB `tdf-chat-2`) from the messages the saved
// page carries in the engine's #chatContainer, so the overlay replays them on start.
// Runs before the overlay loads. The schema below copies src/core/db.js at version 1;
// if that changes, this must too. Re-running is harmless: records are keyed and put.
window.__seedHistory = function () {
  var container = document.getElementById('chatContainer');
  if (!container) return Promise.resolve(0);
  var roomID = String(window.roomID);
  var base = Date.now() - 60 * 60 * 1000;

  // initAll appends its own welcome notice on load; the saved page already has one.
  var seen = {};
  var messages = Array.prototype.filter.call(container.children, function (div) {
    if (!div.classList.contains('welcomeMessage')) return true;
    if (seen[div.textContent]) return false;
    seen[div.textContent] = true;
    return true;
  });

  var records = messages.map(function (div, i) {
    var name = div.querySelector('#username');
    var whisper = name ? /whisperUser\("([^"]*)"\)/.exec(name.getAttribute('onclick') || '') : null;
    var user = whisper ? whisper[1] : '';
    var body = name ? name.nextElementSibling : null;
    var avatar = div.querySelector(':scope > img');
    var style = body ? body.style : {};
    var text = body ? body.innerHTML : '';
    var kind = div.classList.contains('welcomeMessage')
      ? 'system'
      : /^\*\* .* has (joined|left)/.test(body ? body.textContent : '')
        ? (/has left/.test(body.textContent) ? 'exit' : 'entry')
        : 'public';
    var serverId = /^\d+$/.test(div.id) ? div.id : '';
    return {
      id: serverId || 'capture-' + i,
      roomID: roomID,
      mTime: serverId,
      user: user,
      toUser: '',
      kind: kind,
      avatar: avatar ? avatar.getAttribute('src') : '',
      color: style.color || '',
      size: style.fontSize || '',
      family: style.fontFamily || '',
      text: text,
      ircFlag: '0',
      lineBreakFlag: '0',
      receivedAt: base + i,
    };
  });

  records = records.concat(fictionalUsers(records, roomID, base));

  return new Promise(function (resolve, reject) {
    var req = indexedDB.open('tdf-chat-2', 1);
    req.onupgradeneeded = function (event) {
      if (event.oldVersion >= 1) return;
      var db = req.result;
      var messages = db.createObjectStore('messages', { keyPath: 'id' });
      messages.createIndex('roomID', 'roomID');
      messages.createIndex('mTime', 'mTime');
      messages.createIndex('user', 'user');
      messages.createIndex('receivedAt', 'receivedAt');
      messages.createIndex('roomID_receivedAt', ['roomID', 'receivedAt']);
      db.createObjectStore('settings', { keyPath: 'key' });
      var images = db.createObjectStore('images', { keyPath: 'id' });
      images.createIndex('user', 'user');
      images.createIndex('receivedAt', 'receivedAt');
      var tags = db.createObjectStore('tags', { keyPath: 'id', autoIncrement: true });
      tags.createIndex('imageId', 'imageId');
      tags.createIndex('sourceMessageId', 'sourceMessageId');
    };
    req.onerror = function () { reject(req.error); };
    req.onsuccess = function () {
      var db = req.result;
      var tx = db.transaction('messages', 'readwrite');
      var store = tx.objectStore('messages');
      records.forEach(function (r) { store.put(r); });
      tx.oncomplete = function () { db.close(); resolve(records.length); };
      tx.onerror = function () { db.close(); reject(tx.error); };
    };
  });
};

// A third, made-up user for colour variety: Saia, in pink, joins the saved conversation.
// She is added to the engine's user list too, so the sidebar and avatars pick her up.
var SAIA = {
  name: 'Saia',
  uuID: '9001',
  color: '#ff69b4',
  avatar: '/gallery/saia_0004.jpg',
  pic: '/gallery/saia_0010.jpg',
  pic2: '/gallery/saia_0020.jpg',
};

function fictionalUsers(records, roomID, base) {
  addToUserList(SAIA, roomID);
  var lastTime = records.reduce(function (t, r) { return Math.max(t, Number(r.mTime) || 0); }, 0);
  var n = records.length;
  function say(i, delay, kind, text) {
    var mTime = String(lastTime + delay);
    return {
      id: 'saia-' + i,
      roomID: roomID,
      mTime: mTime,
      user: kind === 'entry' ? '' : SAIA.name,
      toUser: '',
      kind: kind,
      avatar: SAIA.avatar,
      color: kind === 'entry' ? '#000000' : SAIA.color,
      size: '13px',
      family: 'Georgia',
      text: text,
      ircFlag: '0',
      lineBreakFlag: '0',
      receivedAt: base + n + i,
    };
  }
  return [
    say(0, 30, 'entry', '** Saia has joined the room ...'),
    say(1, 45, 'public', 'Hi everyone! 👋 What did I miss?'),
    say(2, 60, 'public', '<a href="' + SAIA.pic + '" target="_blank"><img src="' + SAIA.pic + '"></a>'),
    say(3, 75, 'public', 'Tampermonkey? Is that a pet monkey for the browser? 🐒'),
    say(4, 140, 'public', 'one more from today 💕'),
    say(5, 150, 'public', '<a href="' + SAIA.pic2 + '" target="_blank"><img src="' + SAIA.pic2 + '"></a>'),
  ];
}

function addToUserList(user, roomID) {
  var room = document.getElementById('room_' + roomID);
  if (!room || document.getElementById('userlist_' + user.uuID + '1')) return;
  var template = room.querySelector('.userlist');
  if (!template) return;
  var row = template.cloneNode(true);
  row.id = 'userlist_' + user.uuID + '1';
  var img = row.querySelector('img');
  if (img) {
    img.id = 'avatar_' + user.uuID;
    img.setAttribute('src', user.avatar);
  }
  var label = row.querySelector('span[onclick]');
  if (label) {
    label.textContent = user.name;
    label.setAttribute('onclick', 'void 0');
  }
  room.appendChild(row);
  var count = document.getElementById('userCount_' + roomID);
  if (count) count.textContent = String(Number(count.textContent) + 1);
}
