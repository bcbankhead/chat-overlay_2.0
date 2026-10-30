import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { CLOAK_DARK, CLOAK_FADE_MS, CLOAK_ID, CLOAK_LIGHT, CLOAK_MS, cloak } from '../src/core/cloak.js';

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

/** Whether the cloak is still hiding the body, as opposed to fading it in or gone. */
const hiding = (document) =>
  /body \{ opacity: 0 !important; pointer-events: none !important; visibility: hidden !important; \}/.test(document.getElementById(CLOAK_ID)?.textContent ?? '');

test('the cloak makes the body transparent, unclickable and unfocusable, and paints the page background', () => {
  const window = new Window();
  const { document } = window;
  const lift = cloak(document, window);
  const style = document.getElementById(CLOAK_ID);
  assert.ok(style, 'cloak injected');
  assert.equal(style.parentNode, document.head);
  assert.equal(hiding(document), true);
  assert.ok(style.textContent.includes('visibility: hidden !important'), 'the hidden body cannot take focus');
  assert.ok(style.textContent.includes(CLOAK_LIGHT));
  assert.ok(style.textContent.includes(`@media (prefers-color-scheme: dark) { html { background: ${CLOAK_DARK} !important; } }`));
  lift();
  assert.doesNotMatch(style.textContent, /visibility/, 'a lift restores visibility at once');
});

test('a lift fades the body in, then removes the cloak; a second lift is harmless', async () => {
  const window = new Window();
  const { document } = window;
  const lift = cloak(document, window);
  lift();
  const style = document.getElementById(CLOAK_ID);
  assert.ok(style, 'kept while fading');
  assert.equal(hiding(document), false, 'opacity and pointer-events restored at once');
  assert.ok(style.textContent.includes(`body { transition: opacity ${CLOAK_FADE_MS}ms ease-out; }`));
  assert.ok(style.textContent.includes(CLOAK_LIGHT), 'the background stays through the fade');
  lift();
  assert.equal(CLOAK_FADE_MS, 200);
  await settle(CLOAK_FADE_MS + 40);
  assert.equal(document.getElementById(CLOAK_ID), null);
  lift();
  assert.equal(document.getElementById(CLOAK_ID), null);
});

test('the failsafe lifts the cloak after its time, and a lift before it clears the timer', async () => {
  const window = new Window();
  const { document } = window;
  cloak(document, window, 20);
  assert.equal(hiding(document), true);
  await settle(40);
  assert.equal(hiding(document), false, 'fading in');
  await settle(CLOAK_FADE_MS + 40);
  assert.equal(document.getElementById(CLOAK_ID), null);

  let cleared = 0;
  const win = { setTimeout: window.setTimeout.bind(window), clearTimeout: (t) => (cleared += 1, window.clearTimeout(t)) };
  cloak(document, win, 20)();
  assert.equal(cleared, 1);
  assert.equal(CLOAK_MS, 8000);
});

test('onExpire fires once when the failsafe lifts the cloak, and not after a lift', async () => {
  const window = new Window();
  const { document } = window;
  let expired = 0;
  const lift = cloak(document, window, 20, () => (expired += 1));
  await settle(40);
  assert.equal(expired, 1);
  assert.equal(hiding(document), false);
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
