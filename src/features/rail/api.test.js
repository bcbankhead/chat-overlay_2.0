import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  installRailHost,
  listPanels,
  listUserMenuActions,
  onRegistryChange,
  registerRailPanel,
  registerUserMenuAction,
} from './api.js';

const panel = (id, order) => ({ id, title: id, icon: id[0], order, render() {} });
const action = (id, order, isVisible) => ({ id, label: id, order, isVisible, run() {} });
const user = { uuID: '1', name: 'a', rawName: 'a', roomID: '1', userID: '1', avatar: '', block: '1', ip: '', statusText: '' };

test('panels list by order, then registration order', () => {
  const offs = [registerRailPanel(panel('b')), registerRailPanel(panel('a', 5)), registerRailPanel(panel('c'))];
  assert.deepEqual(listPanels().map((p) => p.id), ['a', 'b', 'c']);
  offs.forEach((off) => off());
  assert.deepEqual(listPanels(), []);
});

test('a duplicate id replaces, and the replaced unregister is a no-op', () => {
  const offOld = registerRailPanel({ ...panel('x'), title: 'old' });
  const offNew = registerRailPanel({ ...panel('x'), title: 'new' });
  assert.deepEqual(listPanels().map((p) => p.title), ['new']);
  offOld();
  assert.deepEqual(listPanels().map((p) => p.title), ['new']);
  offNew();
  assert.deepEqual(listPanels(), []);
});

test('user menu actions sort by order and filter by isVisible; a throwing isVisible hides only its action', () => {
  const offs = [
    registerUserMenuAction(action('late', 200)),
    registerUserMenuAction(action('early', 1)),
    registerUserMenuAction(action('hidden', 1, () => false)),
    registerUserMenuAction(action('broken', 1, () => {
      throw new Error('boom');
    })),
    registerUserMenuAction(action('mine', 50, (u) => u.uuID === '1')),
  ];
  const errors = [];
  assert.deepEqual(listUserMenuActions(user, (e) => errors.push(e.message)).map((a) => a.id), ['early', 'mine', 'late']);
  assert.deepEqual(errors, ['user menu action broken: boom']);
  assert.deepEqual(listUserMenuActions({ ...user, uuID: '2' }, () => {}).map((a) => a.id), ['early', 'late']);
  offs.forEach((off) => off());
});

test('every registration and unregistration notifies', () => {
  let calls = 0;
  const unsubscribe = onRegistryChange(() => calls++, () => {});
  const off = registerUserMenuAction(action('n'));
  off();
  off();
  unsubscribe();
  registerRailPanel(panel('quiet'))();
  assert.equal(calls, 2);
});

test('registrations without an id or callback are refused', () => {
  assert.throws(() => registerRailPanel({ title: 't', icon: 'i', render() {} }), TypeError);
  assert.throws(() => registerRailPanel({ id: 'p', title: 't', icon: 'i' }), TypeError);
  assert.throws(() => registerUserMenuAction({ id: 'a', label: 'l' }), TypeError);
});

test('a throwing listener goes to its own sink, and neither skips the rest nor fails the registration', () => {
  const errors = [];
  let calls = 0;
  const offA = onRegistryChange(() => {
    throw new Error('listener broke');
  }, (e) => errors.push(e.message));
  const offB = onRegistryChange(() => calls++, () => {});
  const off = registerRailPanel(panel('ok'));
  assert.equal(calls, 1);
  assert.deepEqual(errors, ['listener broke']);
  assert.deepEqual(listPanels().map((p) => p.id), ['ok']);
  offA();
  off();
  offB();
});

test('registerRailPanel returns the unregister function carrying open(arg?)', () => {
  const handle = registerRailPanel(panel('h'));
  assert.equal(typeof handle, 'function');
  assert.equal(typeof handle.open, 'function');
  handle();
  assert.deepEqual(listPanels(), []);
});

test('open reaches the installed rail with its id and arg; before a rail, it does nothing', () => {
  const handle = registerRailPanel(panel('o'));
  handle.open('early');
  const opened = [];
  const reported = [];
  const uninstall = installRailHost({ open: (p, arg) => opened.push([p.id, arg]), report: (e) => reported.push(e.message) });
  handle.open({ n: 1 });
  handle.open();
  assert.deepEqual(opened, [['o', { n: 1 }], ['o', undefined]]);
  uninstall();
  handle.open('late');
  assert.equal(opened.length, 2);
  assert.deepEqual(reported, []);
  handle();
});

test('a replaced or unregistered handle reports instead of opening', () => {
  const opened = [];
  const reported = [];
  const uninstall = installRailHost({ open: (p) => opened.push(p.id), report: (e) => reported.push(e.message) });
  const old = registerRailPanel(panel('r'));
  const current = registerRailPanel(panel('r'));
  old.open();
  current();
  current.open();
  assert.deepEqual(opened, []);
  assert.deepEqual(reported, ['rail panel r is no longer registered', 'rail panel r is no longer registered']);
  // A stale uninstall leaves a newer rail installed.
  const uninstallNew = installRailHost({ open: (p) => opened.push(p.id), report() {} });
  uninstall();
  const fresh = registerRailPanel(panel('f'));
  fresh.open();
  assert.deepEqual(opened, ['f']);
  fresh();
  uninstallNew();
});
