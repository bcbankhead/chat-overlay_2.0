import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { CLOAK_DARK, CLOAK_ID, CLOAK_LIGHT, CLOAK_MS, cloak } from '../src/core/cloak.js';

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

test('the cloak hides the body and paints the page background until lifted', () => {
  const window = new Window();
  const { document } = window;
  const lift = cloak(document, window);
  const style = document.getElementById(CLOAK_ID);
  assert.ok(style, 'cloak injected');
  assert.equal(style.parentNode, document.head);
  assert.match(style.textContent, /body \{ visibility: hidden !important; \}/);
  assert.ok(style.textContent.includes(CLOAK_LIGHT));
  assert.ok(style.textContent.includes(`@media (prefers-color-scheme: dark) { html { background: ${CLOAK_DARK} !important; } }`));
  lift();
  assert.equal(document.getElementById(CLOAK_ID), null);
  lift();
  assert.equal(document.getElementById(CLOAK_ID), null, 'a second lift is harmless');
});

test('the failsafe lifts the cloak after its time, and a lift before it clears the timer', async () => {
  const window = new Window();
  const { document } = window;
  cloak(document, window, 20);
  assert.ok(document.getElementById(CLOAK_ID));
  await settle(40);
  assert.equal(document.getElementById(CLOAK_ID), null);

  let cleared = 0;
  const win = { setTimeout: window.setTimeout.bind(window), clearTimeout: (t) => (cleared += 1, window.clearTimeout(t)) };
  cloak(document, win, 20)();
  assert.equal(cleared, 1);
  assert.equal(CLOAK_MS, 5000);
});

test('onExpire fires once when the failsafe lifts the cloak, and not after a lift', async () => {
  const window = new Window();
  const { document } = window;
  let expired = 0;
  const lift = cloak(document, window, 20, () => (expired += 1));
  await settle(40);
  assert.equal(expired, 1);
  assert.equal(document.getElementById(CLOAK_ID), null);
  lift();
  assert.equal(expired, 1, 'a later lift does not report again');

  let early = 0;
  cloak(document, window, 20, () => (early += 1))();
  await settle(40);
  assert.equal(early, 0);
});

test('the cloak colours match theme.css\'s page background', () => {
  const css = readFileSync(new URL('../src/core/theme.css', import.meta.url), 'utf8');
  const light = css.match(/\n\.body \{\s*background-color: (#[0-9A-Fa-f]{6})/);
  const dark = css.match(/:root\[data-tdf-theme="dark"\] \.body \{\s*background-color: (#[0-9A-Fa-f]{6})/);
  assert.ok(light && dark, 'theme.css still has the .body rules');
  assert.equal(CLOAK_LIGHT.toLowerCase(), light[1].toLowerCase());
  assert.equal(CLOAK_DARK.toLowerCase(), dark[1].toLowerCase());
});
