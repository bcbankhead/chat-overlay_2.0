import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onInbound } from '../src/core/events.js';
import { engineAvailable, installEngineHook } from '../src/core/engine-hook.js';

/** A fake engine: createMessageDiv renders unless the body says FILTERED or repeats. */
function fakeEngine() {
  const win = {
    userName: 'alice',
    showMessages: 0,
    publicEntry: 'has joined the room ...',
    publicExit: 'has left the room ...',
    receiveMesReq: { readyState: 4, responseXML: null },
    sendReq: {
      readyState: 0,
      status: 0,
      listeners: [],
      addEventListener(type, fn) {
        if (type === 'loadend') this.listeners.push(fn);
      },
      finish(status) {
        this.readyState = 4;
        this.status = status;
        const fns = this.listeners;
        this.listeners = [];
        fns.forEach((fn) => fn());
      },
    },
    sent: [],
    // As the engine: a send while the request is busy is dropped (message.js.php sendData).
    sendData(displayMDiv) {
      if (win.sendReq.readyState == 4 || win.sendReq.readyState == 0) {
        win.sendReq.readyState = 1;
        win.sent.push(displayMDiv);
      }
    },
    timers: [],
    setTimeout(fn) {
      this.timers.push(fn);
    },
    lastText: null,
    mutate: (f) => f,
    createMessageDiv(mStatus, mUID, mDiv, mID, message, sfx, mUser) {
      message = decodeURI(message); // as the engine does first (message.js.php:736)
      if (message.includes('FILTERED')) return false;
      if (mUser.toLowerCase() === win.lastUser && message === win.lastText) return false;
      win.lastUser = mUser.toLowerCase();
      win.lastText = message;
      win.showMessages += 1;
    },
    handleMessages() {
      const nodes = win.receiveMesReq.responseXML.getElementsByTagName('usermessage');
      for (const node of nodes) {
        const f = win.mutate(node.textContent.split('}{'));
        if (!f) continue;
        win.createMessageDiv('0', f[1], f[2], win.showMessages + 1, f[5], f[7], f[3], f[4], f[8]);
      }
    },
  };
  return win;
}

const xml = (...messages) => ({
  getElementsByTagName: () => messages.map((textContent) => ({ textContent })),
});
const um = (id, user, text, mTime, toUser = '') =>
  `${id}}{9}{chatContainer}{${user}}{${toUser}}{${encodeURI(`av.gif|#000|12px|verdana|${text}|0|0`)}}{x}{beep_high.mp3}{${mTime}`;

function setup() {
  const win = fakeEngine();
  const calls = [];
  const history = new Proxy({}, { get: (_, op) => async (...args) => calls.push([op, ...args]) });
  const view = new Proxy({}, { get: (_, op) => (...args) => calls.push([`view.${op}`, ...args]) });
  const hook = installEngineHook({ win, roomID: '1' });
  hook.attach({ history, view });
  const poll = (...messages) => {
    win.receiveMesReq.responseXML = xml(...messages);
    win.handleMessages();
  };
  return { win, calls, ok: hook !== null, poll };
}

test('a rendered server message is stored with its server id and emitted', () => {
  const { calls, ok, poll } = setup();
  const seen = [];
  const off = onInbound((r) => seen.push(r.id));
  assert.equal(ok, true);
  poll(um('901', 'bob', 'hello', '1700'));
  off();
  const put = calls.find((c) => c[0] === 'put');
  assert.equal(put[1].id, '901');
  assert.equal(put[1].mTime, '1700');
  assert.equal(put[1].kind, 'public');
  assert.equal(put[1].text, 'hello');
  assert.ok(calls.some((c) => c[0] === 'view.append'));
  assert.deepEqual(seen, ['901']);
});

test('a message the engine filters is neither stored nor shown', () => {
  const { calls, poll } = setup();
  poll(um('902', 'bob', 'FILTERED', '1701'));
  assert.deepEqual(calls, []);
});

test('the own echo is stored pending, then confirmed by the unrendered server copy', () => {
  const { win, calls, poll } = setup();
  win.createMessageDiv(0, '9', 'chatContainer', 1, 'av.gif|#000|12px|verdana|hi there|0|0', 'beep_high.mp3', 'alice', '', '');
  const pending = calls.find((c) => c[0] === 'addPending')[1];
  assert.match(pending.id, /^local-/);
  assert.equal(pending.confirm, 'pending');
  calls.length = 0;
  poll(um('903', 'alice', 'hi there', '1702')); // dropped by the engine's duplicate filter
  assert.equal(win.showMessages, 1);
  const confirm = calls.find((c) => c[0] === 'confirmPending');
  assert.equal(confirm[1], pending.id);
  assert.equal(confirm[2].id, '903');
  assert.ok(calls.some((c) => c[0] === 'view.confirm'));
  assert.ok(!calls.some((c) => c[0] === 'put'));
  // the expiry timer finds nothing left to mark
  calls.length = 0;
  win.timers.forEach((fn) => fn());
  assert.deepEqual(calls, []);
});

/** As the engine's addMessage: send, then echo the message locally. */
const sendOwn = (win, text) => {
  win.sendData('chatContainer');
  win.createMessageDiv(0, '9', 'chatContainer', 1, `av.gif|#000|12px|verdana|${text}|0|0`, 'beep_high.mp3', 'alice', '', '');
};

test('an own message is confirmed by a 2xx send response, keeping its local id', () => {
  const { win, calls } = setup();
  sendOwn(win, 'sent ok');
  const pending = calls.find((c) => c[0] === 'addPending')[1];
  assert.deepEqual(win.sent, ['chatContainer']);
  assert.ok(!calls.some((c) => c[0] === 'confirmPending'));
  win.sendReq.finish(200);
  const confirm = calls.find((c) => c[0] === 'confirmPending');
  assert.equal(confirm[1], pending.id);
  assert.equal(confirm[2].id, pending.id);
  assert.equal(confirm[2].confirm, undefined);
  assert.equal(confirm[2].text, 'sent ok');
  const viewConfirm = calls.find((c) => c[0] === 'view.confirm');
  assert.equal(viewConfirm[1], pending.id);
  // the expiry timer finds nothing left to mark
  calls.length = 0;
  win.timers.forEach((fn) => fn());
  assert.deepEqual(calls, []);
});

test('an own message whose send fails is marked unconfirmed at once', () => {
  const { win, calls } = setup();
  sendOwn(win, 'server error');
  const id = calls.find((c) => c[0] === 'addPending')[1].id;
  win.sendReq.finish(500);
  assert.ok(calls.some((c) => c[0] === 'markUnconfirmed' && c[1] === id));
  assert.ok(calls.some((c) => c[0] === 'view.markUnconfirmed' && c[1] === id));
  assert.ok(!calls.some((c) => c[0] === 'confirmPending'));
});

test('a send the engine drops while its request is busy is marked unconfirmed; the first still confirms', () => {
  const { win, calls } = setup();
  sendOwn(win, 'first');
  sendOwn(win, 'second'); // sendReq still in flight: the engine drops this send
  const [first, second] = calls.filter((c) => c[0] === 'addPending').map((c) => c[1].id);
  assert.deepEqual(win.sent, ['chatContainer']);
  assert.ok(calls.some((c) => c[0] === 'markUnconfirmed' && c[1] === second));
  win.sendReq.finish(200);
  assert.ok(calls.some((c) => c[0] === 'confirmPending' && c[1] === first));
  assert.ok(!calls.some((c) => c[0] === 'confirmPending' && c[1] === second));
});

test('a self-whisper confirmed by its send is replaced, not duplicated, by its server copy', () => {
  const { win, calls, poll } = setup();
  sendOwn(win, 'note to self');
  const localId = calls.find((c) => c[0] === 'addPending')[1].id;
  win.sendReq.finish(200);
  calls.length = 0;
  win.lastText = null; // the engine renders the delivered copy
  poll(um('950', 'alice', 'note to self', '1750', 'alice'));
  const confirm = calls.find((c) => c[0] === 'confirmPending');
  assert.equal(confirm[1], localId);
  assert.equal(confirm[2].id, '950');
  assert.ok(calls.some((c) => c[0] === 'view.confirm' && c[1] === localId));
  assert.ok(!calls.some((c) => c[0] === 'put' || c[0] === 'view.append'));
});

test('after abandon, sendData passes straight through to the engine', () => {
  const win = fakeEngine();
  const hook = installEngineHook({ win, roomID: '1' });
  hook.abandon();
  win.sendData('chatContainer');
  assert.deepEqual(win.sent, ['chatContainer']);
  assert.deepEqual(win.sendReq.listeners, []);
});

test('an engine without sendData still records own echoes, left to the expiry timer', () => {
  const win = fakeEngine();
  delete win.sendData;
  const calls = [];
  const history = new Proxy({}, { get: (_, op) => async (...args) => calls.push([op, ...args]) });
  const view = new Proxy({}, { get: (_, op) => (...args) => calls.push([`view.${op}`, ...args]) });
  installEngineHook({ win, roomID: '1' }).attach({ history, view });
  assert.equal(win.sendData, undefined);
  win.createMessageDiv(0, '9', 'chatContainer', 1, 'av.gif|#000|12px|verdana|no send hook|0|0', 'beep_high.mp3', 'alice', '', '');
  const id = calls.find((c) => c[0] === 'addPending')[1].id;
  win.timers.forEach((fn) => fn());
  assert.ok(calls.some((c) => c[0] === 'markUnconfirmed' && c[1] === id));
});

test('a send to a private window is not paired with a main-room echo', () => {
  const { win, calls } = setup();
  win.sendData('pcontent_7');
  win.createMessageDiv(0, '9', 'chatContainer', 1, 'av.gif|#000|12px|verdana|unrelated|0|0', 'beep_high.mp3', 'alice', '', '');
  win.sendReq.finish(200);
  assert.ok(!calls.some((c) => c[0] === 'confirmPending'));
});

test('an echo with no server copy is marked unconfirmed by its timer', () => {
  const { win, calls } = setup();
  win.createMessageDiv(0, '9', 'chatContainer', 1, 'av.gif|#000|12px|verdana|lonely|0|0', 'beep_high.mp3', 'alice', '', '');
  const id = calls.find((c) => c[0] === 'addPending')[1].id;
  win.timers.forEach((fn) => fn());
  assert.ok(calls.some((c) => c[0] === 'markUnconfirmed' && c[1] === id));
  assert.ok(calls.some((c) => c[0] === 'view.markUnconfirmed' && c[1] === id));
});

test('an own whisper echo is classified whisper with its recipient', () => {
  const { win, calls } = setup();
  win.createMessageDiv(0, '9', 'chatContainer', 1, 'av.gif|#000|12px|verdana| &#187; bob: psst|1|0', 'beep_high.mp3', 'alice', '', '');
  const rec = calls.find((c) => c[0] === 'addPending')[1];
  assert.equal(rec.kind, 'whisper');
  assert.equal(rec.toUser, 'bob');
});

test('DELETEMESSAGE_ deletes by mTime and is never stored', () => {
  const { calls, poll } = setup();
  poll(um('904', 'mod', 'DELETEMESSAGE_1700', '1703'));
  assert.deepEqual(
    calls.map((c) => c.slice(0, 3)),
    [
      ['deleteByMTime', '1', '1700'],
      ['view.removeByMTime', '1700'],
    ],
  );
});

test('engine-local notices are shown but not stored', () => {
  const { win, calls } = setup();
  win.createMessageDiv('1', '9', 'chatContainer', 1, '../images/notice.gif|#000|12px|verdana|Welcome|1', 'doorbell.mp3', '', '');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'view.append');
  assert.equal(calls[0][1].id, null);
  assert.equal(calls[0][1].kind, 'system');
});

test('private-window messages are ignored', () => {
  const { win, calls } = setup();
  win.createMessageDiv('0', '9', 'pcontent_1_2', 1, 'av.gif|#000|12px|verdana|pm|0|0', 'x', 'bob', 'alice', '1704');
  assert.deepEqual(calls, []);
});

test('missing engine globals install nothing', () => {
  const win = { createMessageDiv() {}, handleMessages() {} };
  const before = { ...win };
  assert.equal(installEngineHook({ win, roomID: '1' }), null);
  assert.equal(win.createMessageDiv, before.createMessageDiv);
  assert.equal(win.handleMessages, before.handleMessages);
});

test('a failed history write is shown as a notice', async () => {
  const win = fakeEngine();
  const calls = [];
  const history = { put: async () => Promise.reject(new Error('QuotaExceededError')) };
  const view = new Proxy({}, { get: (_, op) => (...args) => calls.push([`view.${op}`, ...args]) });
  installEngineHook({ win, roomID: '1' }).attach({ history, view });
  win.receiveMesReq.responseXML = xml(um('905', 'bob', 'hi', '1705'));
  win.handleMessages();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls.at(-1), ['view.notice', 'Chat history not saved: QuotaExceededError']);
});

test('a failing inbound listener is shown as a notice; other listeners still run', () => {
  const { calls, poll } = setup();
  const seen = [];
  const offBad = onInbound(() => {
    throw new Error('gallery broke');
  });
  const offGood = onInbound((r) => seen.push(r.id));
  poll(um('906', 'bob', 'hi', '1706'));
  offBad();
  offGood();
  assert.deepEqual(seen, ['906']);
  assert.ok(calls.some((c) => c[0] === 'view.notice' && c[1] === 'A chat feature failed: gallery broke'));
});

test('an exception inside the hook is shown as a notice and the engine call still returns', () => {
  const win = fakeEngine();
  const notices = [];
  const view = {
    append() {
      throw new Error('render failed');
    },
    notice: (text) => notices.push(text),
  };
  installEngineHook({ win, roomID: '1' }).attach({ history: {}, view });
  const result = win.createMessageDiv('1', '9', 'chatContainer', 1, 'av|#000|12px|v|hi|0|0', 'x', '', '', '');
  assert.equal(result, undefined);
  assert.equal(win.showMessages, 1);
  assert.deepEqual(notices, ['Message not recorded: render failed']);
});

test('a server record that does not match the call is not stored, with a notice saying why', () => {
  const { win, calls, poll } = setup();
  win.mutate = (f) => [...f.slice(0, 8), '1800']; // the engine renders a different mTime
  poll(um('907', 'bob', 'hi', '1707'));
  assert.ok(!calls.some((c) => c[0] === 'put'));
  const shown = calls.find((c) => c[0] === 'view.append');
  assert.equal(shown[1].id, null);
  assert.ok(calls.some((c) => c[0] === 'view.notice' && /not saved: no server record/.test(c[1])));
});

test('a record the engine skips mid-poll does not misalign the records after it', () => {
  const { win, calls, poll } = setup();
  win.mutate = (f) => (f[3] === 'eve' ? null : f); // the engine makes no call for eve's record
  poll(
    um('910', 'bob', 'one', '1710'),
    um('911', 'eve', 'skipped', '1711'),
    um('912', 'carol', 'three', '1712'),
    um('913', 'dave', 'four', '1713'),
  );
  assert.deepEqual(
    calls.filter((c) => c[0] === 'put').map((c) => c[1].id),
    ['910', '912', '913'],
  );
  assert.ok(!calls.some((c) => c[0] === 'view.notice'));
});

test('calls observed before attach are flushed in order once attached', () => {
  const win = fakeEngine();
  const calls = [];
  const history = new Proxy({}, { get: (_, op) => async (...args) => calls.push([op, ...args]) });
  const view = new Proxy({}, { get: (_, op) => (...args) => calls.push([`view.${op}`, ...args]) });
  const hook = installEngineHook({ win, roomID: '1' });
  win.receiveMesReq.responseXML = xml(um('920', 'bob', 'early', '1720'), um('921', 'carol', 'replayed', '1721'));
  win.handleMessages();
  assert.deepEqual(calls, []);
  hook.attach({ history, view, replayed: [{ id: '921' }] });
  assert.deepEqual(
    calls.filter((c) => c[0] === 'put' || c[0] === 'view.append').map((c) => [c[0], c[1].id]),
    [
      ['put', '920'],
      ['view.append', '920'],
    ],
  );
});

test('a pending own message adopted from the previous page is confirmed by its server copy', () => {
  const win = fakeEngine();
  const calls = [];
  const history = new Proxy({}, { get: (_, op) => async (...args) => calls.push([op, ...args]) });
  const view = new Proxy({}, { get: (_, op) => (...args) => calls.push([`view.${op}`, ...args]) });
  const pending = {
    id: 'local-1-0',
    roomID: '1',
    mTime: '',
    user: 'alice',
    toUser: '',
    kind: 'public',
    avatar: 'av.gif',
    color: '#000',
    size: '12px',
    family: 'verdana',
    text: 'before reload',
    ircFlag: '0',
    lineBreakFlag: '0',
    receivedAt: Date.now() - 1000,
    confirm: 'pending',
  };
  installEngineHook({ win, roomID: '1' }).attach({ history, view, pending: [pending], replayed: [pending] });
  win.receiveMesReq.responseXML = xml(um('930', 'alice', 'before reload', '1730'));
  win.handleMessages();
  const confirm = calls.find((c) => c[0] === 'confirmPending');
  assert.equal(confirm[1], 'local-1-0');
  assert.equal(confirm[2].id, '930');
  assert.ok(!calls.some((c) => c[0] === 'put'));
  calls.length = 0;
  win.timers.forEach((fn) => fn());
  assert.deepEqual(calls, []);
});

test('abandon makes the wrappers pass straight through', () => {
  const win = fakeEngine();
  const hook = installEngineHook({ win, roomID: '1' });
  hook.abandon();
  win.receiveMesReq.responseXML = xml(um('940', 'bob', 'hi', '1740'));
  win.handleMessages();
  assert.equal(win.showMessages, 1);
  assert.doesNotThrow(() => hook.attach({ history: {}, view: {} }));
});

test('handleMessages before readyState 4 queues nothing', () => {
  const { win, calls } = setup();
  win.receiveMesReq.readyState = 3;
  win.receiveMesReq.responseXML = xml(um('908', 'bob', 'early', '1708'));
  win.handleMessages();
  // The fake engine still rendered the calls, but without a poll pairing they are not stored.
  assert.ok(!calls.some((c) => c[0] === 'put'));
  assert.ok(calls.some((c) => c[0] === 'view.append' && c[1].id === null));
});

test('engineAvailable needs every wrapped global', () => {
  const full = { receiveMesReq: {}, showMessages: 0, handleMessages() {}, createMessageDiv() {} };
  assert.equal(engineAvailable(full), true);
  for (const key of Object.keys(full)) {
    const partial = { ...full };
    delete partial[key];
    assert.equal(engineAvailable(partial), false, key);
  }
});
