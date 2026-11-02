import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onConfirmChange, onDeleted, onInbound } from '../src/core/events.js';
import { engineAvailable, installEngineHook } from '../src/core/engine-hook.js';
import 'fake-indexeddb/auto';
import { openDb } from '../src/core/db.js';
import { createHistory } from '../src/core/history.js';
import { HISTORY_OFF_KEY } from '../src/core/historyMirror.js';

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

function setup({ storing = undefined } = {}) {
  const win = fakeEngine();
  const calls = [];
  const history = new Proxy({}, { get: (_, op) => async (...args) => calls.push([op, ...args]) });
  const view = new Proxy({}, { get: (_, op) => (...args) => calls.push([`view.${op}`, ...args]) });
  const hook = installEngineHook({ win, roomID: '1' });
  hook.attach({ history, view, ...(storing ? { storing } : {}) });
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
  assert.ok(calls.some((c) => c[0] === 'view.place' && c[1].id === '901'));
  assert.ok(!calls.some((c) => c[0] === 'view.append'));
  assert.deepEqual(seen, ['901']);
});

test("a main-room message to the server's placeholder '_' is public; a named recipient is a whisper", () => {
  const { calls, poll } = setup();
  poll(um('905', 'bob', 'hi all', '1705', '_'), um('906', 'bob', 'psst', '1706', 'carol'));
  const puts = calls.filter((c) => c[0] === 'put').map((c) => [c[1].id, c[1].kind, c[1].toUser]);
  const shown = calls.filter((c) => c[0] === 'view.place').map((c) => [c[1].id, c[1].kind]);
  assert.deepEqual(puts, [
    ['905', 'public', '_'],
    ['906', 'whisper', 'carol'],
  ]);
  assert.deepEqual(shown, [
    ['905', 'public'],
    ['906', 'whisper'],
  ]);
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
  win.sendData('chatContainer');
  assert.equal(win.sendReq.listeners.length, 1); // the wrapper watches a main-div send
  win.sendReq.finish(200);
  hook.abandon();
  win.sendData('chatContainer');
  assert.deepEqual(win.sent, ['chatContainer', 'chatContainer']);
  assert.deepEqual(win.sendReq.listeners, []);
});

test('an engine without sendData still records own echoes, left to the expiry timer', () => {
  const withSend = setup();
  sendOwn(withSend.win, 'send hook');
  withSend.win.sendReq.finish(200);
  assert.ok(withSend.calls.some((c) => c[0] === 'confirmPending')); // the wrapper confirms by the send

  const win = fakeEngine();
  delete win.sendData;
  const calls = [];
  const history = new Proxy({}, { get: (_, op) => async (...args) => calls.push([op, ...args]) });
  const view = new Proxy({}, { get: (_, op) => (...args) => calls.push([`view.${op}`, ...args]) });
  installEngineHook({ win, roomID: '1' }).attach({ history, view });
  assert.equal(win.sendData, undefined);
  win.createMessageDiv(0, '9', 'chatContainer', 1, 'av.gif|#000|12px|verdana|no send hook|0|0', 'beep_high.mp3', 'alice', '', '');
  const id = calls.find((c) => c[0] === 'addPending')[1].id;
  win.sendReq.finish(200);
  assert.ok(!calls.some((c) => c[0] === 'confirmPending' || c[0] === 'markUnconfirmed'));
  win.timers.forEach((fn) => fn());
  assert.ok(calls.some((c) => c[0] === 'markUnconfirmed' && c[1] === id));
});

test('a send to a private window is not paired with a main-room echo', () => {
  const { win, calls } = setup();
  sendOwn(win, 'main room');
  win.sendReq.finish(200);
  const main = calls.find((c) => c[0] === 'addPending')[1].id;
  assert.ok(calls.some((c) => c[0] === 'confirmPending' && c[1] === main)); // a main-div send pairs
  calls.length = 0;
  win.sendData('pcontent_7');
  assert.deepEqual(win.sendReq.listeners, []);
  win.createMessageDiv(0, '9', 'chatContainer', 1, 'av.gif|#000|12px|verdana|unrelated|0|0', 'beep_high.mp3', 'alice', '', '');
  win.sendReq.finish(200);
  assert.ok(calls.some((c) => c[0] === 'addPending'));
  assert.ok(!calls.some((c) => c[0] === 'confirmPending'));
});

test('without a send request the engine cannot post, so the echo is marked unconfirmed at once', () => {
  const win = fakeEngine();
  delete win.sendReq;
  win.sendData = (displayMDiv) => win.sent.push(displayMDiv);
  const calls = [];
  const history = new Proxy({}, { get: (_, op) => async (...args) => calls.push([op, ...args]) });
  const view = new Proxy({}, { get: (_, op) => (...args) => calls.push([`view.${op}`, ...args]) });
  installEngineHook({ win, roomID: '1' }).attach({ history, view });
  sendOwn(win, 'no request');
  const id = calls.find((c) => c[0] === 'addPending')[1].id;
  assert.ok(calls.some((c) => c[0] === 'markUnconfirmed' && c[1] === id));
  assert.ok(calls.some((c) => c[0] === 'view.markUnconfirmed' && c[1] === id));
});

test('a send that completes before attach confirms its buffered echo once attached', () => {
  const win = fakeEngine();
  const calls = [];
  const history = new Proxy({}, { get: (_, op) => async (...args) => calls.push([op, ...args]) });
  const view = new Proxy({}, { get: (_, op) => (...args) => calls.push([`view.${op}`, ...args]) });
  const hook = installEngineHook({ win, roomID: '1' });
  sendOwn(win, 'early send');
  win.sendReq.finish(200);
  assert.deepEqual(calls, []);
  hook.attach({ history, view });
  const id = calls.find((c) => c[0] === 'addPending')[1].id;
  const confirm = calls.find((c) => c[0] === 'confirmPending');
  assert.equal(confirm[1], id);
  assert.equal(confirm[2].text, 'early send');
  assert.ok(calls.some((c) => c[0] === 'view.confirm' && c[1] === id));
});

test('a main-div send with no echo is not paired with a later own echo', async () => {
  const { win, calls } = setup();
  win.sendData('chatContainer'); // room entry: the engine echoes nothing
  win.createMessageDiv('1', '9', 'chatContainer', 1, '../images/notice.gif|#000|12px|verdana|AdBot|1', 'x', '', '');
  win.sendReq.finish(200);
  win.createMessageDiv(0, '9', 'chatContainer', 1, 'av.gif|#000|12px|verdana|after adbot|0|0', 'beep_high.mp3', 'alice', '', '');
  win.sendData('chatContainer'); // room exit: nothing is rendered after it in this task
  win.sendReq.finish(200);
  await Promise.resolve();
  win.createMessageDiv(0, '9', 'chatContainer', 1, 'av.gif|#000|12px|verdana|later|0|0', 'beep_high.mp3', 'alice', '', '');
  assert.equal(calls.filter((c) => c[0] === 'addPending').length, 2);
  assert.ok(!calls.some((c) => c[0] === 'confirmPending' || c[0] === 'markUnconfirmed'));
  sendOwn(win, 'paired');
  win.sendReq.finish(200);
  const paired = calls.filter((c) => c[0] === 'addPending').at(-1)[1].id;
  assert.deepEqual(
    calls.filter((c) => c[0] === 'confirmPending').map((c) => c[1]),
    [paired],
  );
});

/** A view whose `op` throws; notices are collected. */
const throwingView = (op, notices) =>
  new Proxy(
    {},
    {
      get: (_, name) => {
        if (name === 'notice') return (text) => notices.push(text);
        if (name === op)
          return () => {
            throw new Error(`${op} failed`);
          };
        return () => {};
      },
    },
  );
const quietHistory = new Proxy({}, { get: () => async () => true });

test('a throw in the send wrapper is shown as a notice; the engine send and echo still run', () => {
  const win = fakeEngine();
  win.sendReq.addEventListener = () => {
    throw new Error('listener refused');
  };
  const notices = [];
  const calls = [];
  const history = new Proxy({}, { get: (_, op) => async (...args) => calls.push([op, ...args]) });
  installEngineHook({ win, roomID: '1' }).attach({ history, view: throwingView(null, notices) });
  assert.doesNotThrow(() => sendOwn(win, 'still echoed'));
  assert.deepEqual(win.sent, ['chatContainer']);
  assert.ok(calls.some((c) => c[0] === 'addPending'));
  assert.deepEqual(notices, ['Message status not tracked: listener refused']);
});

test('a throw while settling a send response is shown as a notice', () => {
  const win = fakeEngine();
  const notices = [];
  installEngineHook({ win, roomID: '1' }).attach({ history: quietHistory, view: throwingView('confirm', notices) });
  sendOwn(win, 'confirm throws');
  assert.doesNotThrow(() => win.sendReq.finish(200));
  assert.deepEqual(notices, ['Message status not updated: confirm failed']);
});

test('a throw in the expiry timer is shown as a notice', () => {
  const win = fakeEngine();
  const notices = [];
  installEngineHook({ win, roomID: '1' }).attach({ history: quietHistory, view: throwingView('markUnconfirmed', notices) });
  win.createMessageDiv(0, '9', 'chatContainer', 1, 'av.gif|#000|12px|verdana|expires|0|0', 'beep_high.mp3', 'alice', '', '');
  assert.doesNotThrow(() => win.timers.forEach((fn) => fn()));
  assert.deepEqual(notices, ['Message status not updated: markUnconfirmed failed']);
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
    calls.filter((c) => c[0] === 'put' || c[0] === 'view.place').map((c) => [c[0], c[1].id]),
    [
      ['put', '920'],
      ['view.place', '920'],
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

test('a pending own message going unconfirmed is announced, by its send or its timer', (t) => {
  const changes = [];
  t.after(onConfirmChange((c) => changes.push(c)));
  const failed = setup();
  sendOwn(failed.win, 'server error');
  const id = failed.calls.find((c) => c[0] === 'addPending')[1].id;
  failed.win.sendReq.finish(500);
  const timed = setup();
  timed.win.createMessageDiv(0, '9', 'chatContainer', 1, 'av.gif|#000|12px|verdana|lonely|0|0', 'beep_high.mp3', 'alice', '', '');
  const lonely = timed.calls.find((c) => c[0] === 'addPending')[1].id;
  timed.win.timers.forEach((fn) => fn());
  assert.deepEqual(changes, [
    { roomID: '1', ids: [id], confirm: 'unconfirmed' },
    { roomID: '1', ids: [lonely], confirm: 'unconfirmed' },
  ]);
  // A confirmed one is not announced: its timer finds nothing left to mark.
  const sent = setup();
  sendOwn(sent.win, 'fine');
  sent.win.sendReq.finish(200);
  sent.win.timers.forEach((fn) => fn());
  assert.equal(changes.length, 2);
});

test('an admin delete announces the stored record it deleted, once committed', async (t) => {
  const deleted = [];
  t.after(onDeleted((ids) => deleted.push(ids)));
  const win = fakeEngine();
  const calls = [];
  const history = { deleteByMTime: async () => ['904-target'] };
  const view = new Proxy({}, { get: (_, op) => (...args) => calls.push([`view.${op}`, ...args]) });
  installEngineHook({ win, roomID: '1' }).attach({ history, view });
  win.receiveMesReq.responseXML = xml(um('904', 'mod', 'DELETEMESSAGE_1700', '1703'));
  win.handleMessages();
  assert.deepEqual(calls, [['view.removeByMTime', '1700']]);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(deleted, [['904-target']]);
});

test('with Chat history off nothing is written, but messages are still shown and announced', () => {
  let storing = false;
  const { win, calls, poll } = setup({ storing: () => storing });
  const seen = [];
  const off = onInbound((r) => seen.push(r.id));
  poll(um('950', 'bob', 'hello', '1750'));
  sendOwn(win, 'mine');
  win.sendReq.finish(200);
  off();
  const ops = calls.map((c) => c[0]);
  for (const op of ['put', 'addPending', 'confirmPending']) assert.ok(!ops.includes(op), op);
  assert.ok(ops.includes('view.append') && ops.includes('view.confirm'));
  assert.equal(seen.length, 2);
  // Read per message: a limit set later stores again.
  storing = true;
  poll(um('951', 'bob', 'again', '1751'));
  assert.ok(calls.some((c) => c[0] === 'put' && c[1].id === '951'));
});

test('a second tab whose first poll re-delivers the backlog does not reorder the next replay', async () => {
  const name = 'engine-hook-two-tabs';
  const noView = new Proxy({}, { get: () => () => {} });
  /** One tab: its own engine, its own connection to the shared database. */
  const tab = async () => {
    const win = fakeEngine();
    const history = createHistory(await openDb({ name }));
    installEngineHook({ win, roomID: '1' }).attach({ history, view: noView });
    const poll = (...messages) => {
      win.receiveMesReq.responseXML = xml(...messages);
      win.handleMessages();
    };
    return { history, poll };
  };
  const flush = () => new Promise((r) => setTimeout(r, 20));
  const backlog = [um('801', 'bob', 'one', '1800'), um('802', 'carol', 'two', '1801')];

  const first = await tab();
  first.poll(...backlog);
  first.poll(um('803', 'bob', 'three', '1900'));
  await flush();
  const seen = (await first.history.get('801'))?.receivedAt;

  // A new tab with nothing replayed: its first poll hands it the server backlog again.
  const second = await tab();
  second.poll(...backlog);
  await flush();

  assert.deepEqual(
    (await second.history.recent('1')).map((r) => r.id),
    ['801', '802', '803'],
  );
  assert.deepEqual(
    (await first.history.recent('1', 1)).map((r) => r.id),
    ['803'],
    'the newest message is still the newest',
  );
  assert.equal((await second.history.get('801'))?.receivedAt, seen, 'first-seen receipt time kept');
});

test("with a skewed client clock, an own message orders by its estimated server time among others'", async (t) => {
  // The client clock runs ten minutes ahead of the server's.
  const skew = 600_000;
  const local0 = Math.ceil((Date.now() + 1e9) / 1000) * 1000;
  const server0 = (local0 - skew) / 1000;
  let clock = local0;
  t.mock.method(Date, 'now', () => clock);
  const win = fakeEngine();
  const history = createHistory(await openDb({ name: 'engine-hook-skew' }));
  installEngineHook({ win, roomID: '1' }).attach({ history, view: new Proxy({}, { get: () => () => {} }) });
  const poll = (...messages) => {
    win.receiveMesReq.responseXML = xml(...messages);
    win.handleMessages();
  };

  clock = local0 + 500;
  poll(um('701', 'bob', 'question', String(server0)));
  clock = local0 + 2_000;
  sendOwn(win, 'answer');
  win.sendReq.finish(200);
  clock = local0 + 5_300;
  poll(um('702', 'bob', 'thanks', String(server0 + 5)));
  await new Promise((r) => setTimeout(r, 20));

  const replay = await history.recent('1');
  assert.deepEqual(
    replay.map((r) => r.text),
    ['question', 'answer', 'thanks'],
  );
  const own = replay[1];
  assert.equal(own.mTime, '', 'still no server mTime');
  assert.equal(own.orderKey, own.receivedAt - skew - 500, 'receipt time moved by the observed skew');
});

test('with no server record observed yet, a confirmed own message orders by its receipt time', async () => {
  const { win, calls } = setup();
  sendOwn(win, 'first words');
  win.sendReq.finish(200);
  const confirmed = calls.find((c) => c[0] === 'confirmPending')[2];
  assert.equal(confirmed.orderAt, undefined);

  const history = createHistory(await openDb({ name: 'engine-hook-no-skew' }));
  await history.addPending({ ...confirmed, confirm: 'pending' });
  await history.confirmPending(confirmed.id, confirmed);
  assert.equal((await history.get(confirmed.id))?.orderKey, confirmed.receivedAt);
});

// TDF-0032: server records are placed by order; own echoes and engine notices append.
test('a server record goes to view.place; an own echo and an engine notice to view.append', () => {
  const { win, calls, poll } = setup();
  poll(um('950', 'bob', 'hi', '1750'));
  sendOwn(win, 'mine');
  win.createMessageDiv('1', '9', 'chatContainer', 1, 'av|#000|12px|v|welcome|0|0', 'x', '', '', '');
  const shown = calls.filter((c) => c[0] === 'view.place' || c[0] === 'view.append').map((c) => [c[0], c[1].id === null ? null : c[1].text]);
  assert.deepEqual(shown, [
    ['view.place', 'hi'],
    ['view.append', 'mine'],
    ['view.append', null],
  ]);
});

test('before any poll, a pending own message and an engine notice carry no orderAt', () => {
  const { win, calls } = setup();
  sendOwn(win, 'early');
  win.createMessageDiv('1', '9', 'chatContainer', 1, 'av|#000|12px|v|welcome|0|0', 'x', '', '', '');
  const pending = calls.find((c) => c[0] === 'addPending')[1];
  assert.equal('orderAt' in pending, false);
  const notice = calls.find((c) => c[0] === 'view.append' && c[1].id === null)[1];
  assert.equal('orderAt' in notice, false);
});

test('after a poll, a pending own message and an engine notice order on the server clock', (t) => {
  // The device clock runs 30 s ahead of the server's.
  const skew = 30_000;
  const local0 = Math.ceil((Date.now() + 1e9) / 1000) * 1000;
  let clock = local0;
  t.mock.method(Date, 'now', () => clock);
  const { win, calls, poll } = setup();
  poll(um('951', 'bob', 'hi', String((local0 - skew) / 1000)));
  clock = local0 + 2_000;
  sendOwn(win, 'mine');
  const pending = calls.find((c) => c[0] === 'addPending')[1];
  assert.equal(pending.orderAt, pending.receivedAt - skew, 'receipt moved onto the server clock');
  const shownOwn = calls.find((c) => c[0] === 'view.append' && c[1].text === 'mine')[1];
  assert.equal(shownOwn.orderAt, pending.orderAt, 'the view orders it as storage does');
  clock = local0 + 3_000;
  win.createMessageDiv('1', '9', 'chatContainer', 1, 'av|#000|12px|v|welcome|0|0', 'x', '', '', '');
  const notice = calls.find((c) => c[0] === 'view.append' && c[1].id === null)[1];
  assert.equal(notice.orderAt, local0 + 3_000 - skew);
});

test('a stored pending own message orders by its corrected orderAt', async (t) => {
  const skew = 30_000;
  const local0 = Math.ceil((Date.now() + 2e9) / 1000) * 1000;
  let clock = local0;
  t.mock.method(Date, 'now', () => clock);
  const win = fakeEngine();
  const history = createHistory(await openDb({ name: 'engine-hook-pending-order' }));
  installEngineHook({ win, roomID: '1' }).attach({ history, view: new Proxy({}, { get: () => () => {} }) });
  win.receiveMesReq.responseXML = xml(um('952', 'bob', 'hi', String((local0 - skew) / 1000)));
  win.handleMessages();
  clock = local0 + 2_000;
  sendOwn(win, 'still pending');
  await new Promise((r) => setTimeout(r, 20));
  const own = (await history.recent('1')).find((r) => r.text === 'still pending');
  assert.equal(own.confirm, 'pending');
  assert.equal(own.orderKey, own.receivedAt - skew);
});

// TDF-0033.2: server-history blocks.

/** The engine's history flag: set for the first poll, cleared at the end of that call. */
function withHistoryFlag(win) {
  win.showHistory = 1;
  const handle = win.handleMessages;
  win.handleMessages = function () {
    try {
      return handle.apply(this, arguments);
    } finally {
      win.showHistory = 0;
    }
  };
  return win;
}

test('only records from the history poll are tagged, all with one page-load block id', () => {
  const win = withHistoryFlag(fakeEngine());
  const calls = [];
  const history = new Proxy({}, { get: (_, op) => async (...args) => calls.push([op, ...args]) });
  const view = new Proxy({}, { get: (_, op) => (...args) => calls.push([`view.${op}`, ...args]) });
  installEngineHook({ win, roomID: '1' }).attach({ history, view });
  const poll = (...messages) => {
    win.receiveMesReq.responseXML = xml(...messages);
    win.handleMessages();
  };
  poll(um('1001', 'bob', 'old one', '1600'), um('1002', 'carol', 'old two', '1601'));
  poll(um('1003', 'bob', 'live', '1700'));
  const puts = calls.filter((c) => c[0] === 'put').map((c) => c[1]);
  assert.equal(puts[0].source, 'backlog');
  assert.equal(typeof puts[0].backlogBlock, 'string');
  assert.ok(puts[0].backlogBlock.length > 0);
  assert.equal(puts[1].backlogBlock, puts[0].backlogBlock);
  assert.equal(puts[2].source, undefined);
  assert.equal(puts[2].backlogBlock, undefined);
  const placed = calls.filter((c) => c[0] === 'view.place').map((c) => c[1].backlogBlock);
  assert.deepEqual(placed, [puts[0].backlogBlock, puts[0].backlogBlock, undefined]);
});

test('without the history flag no record is tagged', () => {
  const { calls, poll } = setup();
  poll(um('1010', 'bob', 'hello', '1700'));
  assert.equal(calls.find((c) => c[0] === 'put')[1].source, undefined);
});

test('each page load gets its own block id', () => {
  const ids = [];
  for (let i = 0; i < 2; i++) {
    const win = withHistoryFlag(fakeEngine());
    const calls = [];
    const history = new Proxy({}, { get: (_, op) => async (...args) => calls.push([op, ...args]) });
    const view = new Proxy({}, { get: () => () => {} });
    installEngineHook({ win, roomID: '1' }).attach({ history, view });
    win.receiveMesReq.responseXML = xml(um('1020', 'bob', 'old', '1600'));
    win.handleMessages();
    ids.push(calls.find((c) => c[0] === 'put')[1].backlogBlock);
  }
  assert.notEqual(ids[0], ids[1]);
});

test('a history poll handled before attach keeps its tag through the buffer', () => {
  const win = withHistoryFlag(fakeEngine());
  const calls = [];
  const history = new Proxy({}, { get: (_, op) => async (...args) => calls.push([op, ...args]) });
  const view = new Proxy({}, { get: () => () => {} });
  const hook = installEngineHook({ win, roomID: '1' });
  win.receiveMesReq.responseXML = xml(um('1030', 'bob', 'early', '1600'));
  win.handleMessages();
  win.receiveMesReq.responseXML = xml(um('1031', 'bob', 'live', '1700'));
  win.handleMessages();
  hook.attach({ history, view });
  const puts = calls.filter((c) => c[0] === 'put').map((c) => [c[1].id, c[1].source]);
  assert.deepEqual(puts, [
    ['1030', 'backlog'],
    ['1031', undefined],
  ]);
});

test('a history poll in flight at install is rebound to the wrapper and tagged', () => {
  const win = fakeEngine();
  win.showHistory = 1;
  const engineHandle = win.handleMessages;
  win.receiveMesReq = { readyState: 1, responseXML: null, onreadystatechange: engineHandle };
  const calls = [];
  const history = new Proxy({}, { get: (_, op) => async (...args) => calls.push([op, ...args]) });
  const view = new Proxy({}, { get: () => () => {} });
  installEngineHook({ win, roomID: '1' }).attach({ history, view });
  assert.notEqual(win.receiveMesReq.onreadystatechange, engineHandle);
  assert.equal(win.receiveMesReq.onreadystatechange, win.handleMessages);
  win.receiveMesReq.readyState = 4;
  win.receiveMesReq.responseXML = xml(um('1040', 'bob', 'old', '1600'));
  win.receiveMesReq.onreadystatechange();
  assert.equal(calls.find((c) => c[0] === 'put')[1].source, 'backlog');
});

test('a history poll completed before install is left alone and yields no tag', () => {
  const win = fakeEngine();
  const engineHandle = win.handleMessages;
  win.showHistory = 0; // the engine cleared it after handling the history poll
  win.receiveMesReq = { readyState: 4, responseXML: null, onreadystatechange: engineHandle };
  const calls = [];
  const history = new Proxy({}, { get: (_, op) => async (...args) => calls.push([op, ...args]) });
  const view = new Proxy({}, { get: () => () => {} });
  installEngineHook({ win, roomID: '1' }).attach({ history, view });
  assert.equal(win.receiveMesReq.onreadystatechange, engineHandle);
  win.receiveMesReq.responseXML = xml(um('1050', 'bob', 'next poll', '1700'));
  win.handleMessages();
  assert.equal(calls.find((c) => c[0] === 'put')[1].source, undefined);
});

test("the page-load block id comes from the browser's randomUUID where it has one", () => {
  const win = withHistoryFlag(fakeEngine());
  win.crypto = { randomUUID: () => 'uuid-1' };
  const calls = [];
  const history = new Proxy({}, { get: (_, op) => async (...args) => calls.push([op, ...args]) });
  const view = new Proxy({}, { get: () => () => {} });
  installEngineHook({ win, roomID: '1' }).attach({ history, view });
  win.receiveMesReq.responseXML = xml(um('1060', 'bob', 'old', '1600'));
  win.handleMessages();
  assert.equal(calls.find((c) => c[0] === 'put')[1].backlogBlock, 'uuid-1');
});

// TDF-0054: with Chat history off, messages the server sent from before the page loaded skip
// the engine. The cutoff is the first poll reply's Date header, on the server's clock.

const SERVER_DATE = 'Mon, 02 Nov 2026 15:00:00 GMT';
const SERVER_NOW = Date.parse(SERVER_DATE) / 1000;
const preLoad = String(SERVER_NOW - 600);
const postLoad = String(SERVER_NOW + 5);

/** A fake engine whose poll replies carry `date` as their Date header, counting createMessageDiv runs. */
function datedEngine(date = SERVER_DATE) {
  const win = fakeEngine();
  win.engineCalls = 0;
  const create = win.createMessageDiv;
  win.createMessageDiv = function (...args) {
    win.engineCalls += 1;
    return create.apply(this, args);
  };
  win.receiveMesReq.getResponseHeader = (name) => (name.toLowerCase() === 'date' ? date : null);
  return win;
}

function datedSetup({ storing = () => true, date = SERVER_DATE } = {}) {
  const win = datedEngine(date);
  const calls = [];
  const history = new Proxy({}, { get: (_, op) => async (...args) => calls.push([op, ...args]) });
  const view = new Proxy({}, { get: (_, op) => (...args) => calls.push([`view.${op}`, ...args]) });
  const hook = installEngineHook({ win, roomID: '1' });
  hook.attach({ history, view, storing });
  const poll = (...messages) => {
    win.receiveMesReq.responseXML = xml(...messages);
    win.handleMessages();
  };
  return { win, calls, poll };
}

test('history off: a message from before the page load skips the engine and is not stored, shown or announced', () => {
  const { win, calls, poll } = datedSetup({ storing: () => false });
  const results = [];
  const wrapped = win.createMessageDiv;
  win.createMessageDiv = function (...args) {
    const r = wrapped.apply(this, args);
    results.push(r);
    return r;
  };
  const seen = [];
  const off = onInbound((r) => seen.push(r.id));
  poll(um('1100', 'bob', 'old', preLoad), um('1101', 'carol', 'older', String(SERVER_NOW - 3600)));
  off();
  assert.equal(win.engineCalls, 0);
  assert.equal(win.showMessages, 0);
  assert.deepEqual(results, [false, false]);
  assert.deepEqual(calls, []);
  assert.deepEqual(seen, []);
});

test('history off: a message sent after the page load still draws', () => {
  const { win, calls, poll } = datedSetup({ storing: () => false });
  poll(um('1102', 'bob', 'old', preLoad), um('1103', 'bob', 'new', postLoad));
  assert.equal(win.engineCalls, 1);
  assert.deepEqual(
    calls.filter((c) => c[0] === 'view.place').map((c) => c[1].id),
    ['1103'],
  );
  poll(um('1104', 'carol', 'later', String(SERVER_NOW + 30)));
  assert.equal(win.engineCalls, 2);
});

test('history off: the cutoff is read from the first reply only', () => {
  const { win, poll } = datedSetup({ storing: () => false });
  poll(um('1105', 'bob', 'first', postLoad));
  win.receiveMesReq.getResponseHeader = () => 'Mon, 02 Nov 2026 18:00:00 GMT';
  poll(um('1106', 'bob', 'second', String(SERVER_NOW + 60)));
  assert.equal(win.engineCalls, 2);
});

test('history off: without a usable Date header nothing is suppressed', () => {
  for (const date of [null, 'not a date']) {
    const { win, calls, poll } = datedSetup({ storing: () => false, date });
    poll(um('1107', 'bob', 'old', preLoad));
    assert.equal(win.engineCalls, 1, String(date));
    assert.ok(calls.some((c) => c[0] === 'view.place' && c[1].id === '1107'));
  }
});

test('a Date header read that throws is shown as a notice, and nothing is suppressed', () => {
  const { win, calls, poll } = datedSetup({ storing: () => false });
  win.receiveMesReq.getResponseHeader = () => {
    throw new Error('header denied');
  };
  poll(um('1111', 'bob', 'old', preLoad));
  assert.ok(calls.some((c) => c[0] === 'view.notice' && c[1] === 'Page load time not read: header denied'));
  assert.equal(win.engineCalls, 1);
});

test('a history setting read that throws is shown as a notice, and the message still draws', () => {
  const { win, calls, poll } = datedSetup({
    storing: () => {
      throw new Error('setting denied');
    },
  });
  poll(um('1112', 'bob', 'old', preLoad));
  assert.ok(calls.some((c) => c[0] === 'view.notice' && c[1] === 'History setting not read: setting denied'));
  assert.equal(win.engineCalls, 1);
});

test('history on: a message from before the page load draws and is stored, as before', () => {
  const { win, calls, poll } = datedSetup();
  poll(um('1108', 'bob', 'old', preLoad));
  assert.equal(win.engineCalls, 1);
  assert.ok(calls.some((c) => c[0] === 'put' && c[1].id === '1108'));
  assert.ok(calls.some((c) => c[0] === 'view.place' && c[1].id === '1108'));
});

test('history off: engine notices with no server record are untouched', () => {
  const { win, calls, poll } = datedSetup({ storing: () => false });
  poll(um('1109', 'bob', 'old', preLoad));
  win.createMessageDiv('0', '-1', 'chatContainer', -2, '1|#000|12px|verdana|** alice has joined', 'beep_high.mp3', '', '', '');
  assert.equal(win.engineCalls, 1);
  assert.ok(calls.some((c) => c[0] === 'view.append'));
});

test('before attach, the history-off mirror decides: off suppresses; on and a throwing storage draw', () => {
  /** @param {unknown} storage */
  const run = (storage) => {
    const win = datedEngine();
    Object.defineProperty(win, 'localStorage', { configurable: true, get: () => storage });
    const calls = [];
    const history = new Proxy({}, { get: (_, op) => async (...args) => calls.push([op, ...args]) });
    const view = new Proxy({}, { get: (_, op) => (...args) => calls.push([`view.${op}`, ...args]) });
    const hook = installEngineHook({ win, roomID: '1' });
    win.receiveMesReq.responseXML = xml(um('1110', 'bob', 'old', preLoad));
    win.handleMessages();
    hook.attach({ history, view, storing: () => false });
    return { engineCalls: win.engineCalls, calls };
  };
  const off = run({ getItem: (key) => (key === HISTORY_OFF_KEY ? '1' : null) });
  assert.equal(off.engineCalls, 0);
  assert.deepEqual(off.calls, []);
  assert.equal(run({ getItem: () => null }).engineCalls, 1);
  const denied = run({
    getItem() {
      throw new Error('denied');
    },
  });
  assert.equal(denied.engineCalls, 1);
});

/** A raw server record with its own target div and body, as the poll XML carries it. */
const rawRecord = (id, { div = 'chatContainer', user = 'bob', toUser = '', body, mTime }) =>
  `${id}}{9}{${div}}{${user}}{${toUser}}{${body}}{x}{beep_high.mp3}{${mTime}`;

test('history off: a pre-load SILENCE, BAN or KICK aimed at the user still reaches the engine', () => {
  for (const command of ['SILENCE', 'BAN', 'KICK']) {
    const { win, poll } = datedSetup({ storing: () => false });
    poll(rawRecord('1200', { user: 'mod', toUser: 'alice', body: command, mTime: preLoad }));
    assert.equal(win.engineCalls, 1, command);
  }
});

test('history off: a pre-load admin delete still reaches the engine', () => {
  const { win, poll } = datedSetup({ storing: () => false });
  poll(rawRecord('1201', { user: 'mod', body: encodeURI(`DELETEMESSAGE_av.gif|#000|12px|verdana|${preLoad}`), mTime: preLoad }));
  assert.equal(win.engineCalls, 1);
});

test('history off: a pre-load private-window message is not suppressed', () => {
  const { win, poll } = datedSetup({ storing: () => false });
  poll(
    rawRecord('1202', {
      div: 'pcontent_9_1',
      toUser: 'alice',
      body: encodeURI('av.gif|#000|12px|verdana|private|0|0'),
      mTime: preLoad,
    }),
  );
  assert.equal(win.engineCalls, 1);
});

test('history off: a first reply with no Date header leaves the cutoff to a later reply', () => {
  const { win, poll } = datedSetup({ storing: () => false, date: null });
  poll(um('1203', 'bob', 'first', preLoad));
  assert.equal(win.engineCalls, 1);
  win.receiveMesReq.getResponseHeader = (name) => (name.toLowerCase() === 'date' ? SERVER_DATE : null);
  poll(um('1204', 'carol', 'retried', preLoad));
  assert.equal(win.engineCalls, 1);
  win.receiveMesReq.getResponseHeader = () => 'Mon, 02 Nov 2026 18:00:00 GMT';
  poll(um('1205', 'carol', 'live', postLoad));
  assert.equal(win.engineCalls, 2);
});

test('a Date header read that throws before attach shows its notice once attached', () => {
  const win = datedEngine();
  win.receiveMesReq.getResponseHeader = () => {
    throw new Error('header denied');
  };
  const calls = [];
  const history = new Proxy({}, { get: (_, op) => async (...args) => calls.push([op, ...args]) });
  const view = new Proxy({}, { get: (_, op) => (...args) => calls.push([`view.${op}`, ...args]) });
  const hook = installEngineHook({ win, roomID: '1' });
  win.receiveMesReq.responseXML = xml(um('1206', 'bob', 'old', preLoad));
  win.handleMessages();
  assert.deepEqual(calls, []);
  hook.attach({ history, view, storing: () => false });
  assert.ok(calls.some((c) => c[0] === 'view.notice' && c[1] === 'Page load time not read: header denied'));
  assert.equal(win.engineCalls, 1);
});
