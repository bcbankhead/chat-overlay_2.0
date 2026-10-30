import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { FADE_CLASS, createTheme } from '../src/core/theme.js';

/** In-memory stand-in for the settings accessor. */
function fakeSettings(initial = {}, { failSet = false } = {}) {
  const values = { theme: null, ...initial };
  return {
    values,
    async get(key) {
      return values[key];
    },
    async set(key, value) {
      if (failSet) throw new Error('quota exceeded');
      values[key] = value;
    },
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function setup({ dark = false, reduced = false, settings = fakeSettings() } = {}) {
  const win = new Window();
  const root = win.document.documentElement;
  const listeners = [];
  win.matchMedia = (query) => ({
    get matches() {
      return query.includes('reduced-motion') ? reduced : dark;
    },
    addEventListener: (_, fn) => listeners.push(fn),
    removeEventListener: (_, fn) => listeners.splice(listeners.indexOf(fn), 1),
  });
  const theme = createTheme({ win, settings, root });
  await theme.load();
  const flipScheme = (d) => {
    dark = d;
    [...listeners].forEach((fn) => fn());
  };
  return { theme, root, settings, flipScheme, listeners };
}

test('with no stored choice the theme follows the system, at load and live', async () => {
  const { theme, root, flipScheme } = await setup({ dark: true });
  assert.equal(root.dataset.tdfTheme, 'dark');
  assert.equal(theme.current(), 'dark');
  flipScheme(false);
  assert.equal(root.dataset.tdfTheme, 'light');
});

test('a stored legacy auto, or any unknown value, reads as no choice', async () => {
  for (const value of ['auto', 'neon', undefined]) {
    const { root, flipScheme } = await setup({ dark: true, settings: fakeSettings({ theme: value }) });
    assert.equal(root.dataset.tdfTheme, 'dark');
    flipScheme(false);
    assert.equal(root.dataset.tdfTheme, 'light', `${value} follows the system`);
  }
});

test('a stored choice loads and ignores the system', async () => {
  const { root, flipScheme } = await setup({ dark: false, settings: fakeSettings({ theme: 'dark' }) });
  assert.equal(root.dataset.tdfTheme, 'dark');
  flipScheme(false);
  assert.equal(root.dataset.tdfTheme, 'dark');
});

test('the toggle flips light and dark only, persists the choice, and stops following the system', async () => {
  const { theme, root, settings, flipScheme } = await setup({ dark: true });
  const seen = [];
  const off = theme.onChange((t) => seen.push(t));
  await theme.toggle();
  assert.equal(root.dataset.tdfTheme, 'light');
  assert.equal(settings.values.theme, 'light');
  flipScheme(true);
  assert.equal(root.dataset.tdfTheme, 'light');
  await theme.toggle();
  assert.equal(root.dataset.tdfTheme, 'dark');
  assert.equal(settings.values.theme, 'dark');
  off();
  await theme.toggle();
  assert.deepEqual(seen, ['light', 'dark']);
});

test('a failed save rejects the toggle; the switch itself still applies', async () => {
  const { theme, root } = await setup({ settings: fakeSettings({}, { failSet: true }) });
  await assert.rejects(theme.toggle(), /quota exceeded/);
  assert.equal(root.dataset.tdfTheme, 'dark');
});

test('a switch cross-fades for a moment; the first apply does not', async () => {
  const { theme, root } = await setup();
  assert.equal(root.classList.contains('tdf-theme-fading'), false);
  await theme.toggle();
  assert.equal(root.classList.contains('tdf-theme-fading'), true);
  await wait(500);
  assert.equal(root.classList.contains('tdf-theme-fading'), false);
  // A live system change fades too, once a theme is applied.
  const fresh = await setup({ dark: false });
  fresh.flipScheme(true);
  assert.equal(fresh.root.classList.contains('tdf-theme-fading'), true);
});

test('each switch restarts the fade timer', async () => {
  const { theme, root } = await setup();
  await theme.toggle();
  await wait(300);
  await theme.toggle();
  await wait(300);
  assert.equal(root.classList.contains('tdf-theme-fading'), true, 'still fading 300 ms after the second switch');
  await wait(250);
  assert.equal(root.classList.contains('tdf-theme-fading'), false);
});

test('no fade under reduced motion', async () => {
  const { theme, root } = await setup({ reduced: true });
  await theme.toggle();
  assert.equal(root.dataset.tdfTheme, 'dark');
  assert.equal(root.classList.contains('tdf-theme-fading'), false);
});

test('stop leaves the system unfollowed', async () => {
  const { theme, root, flipScheme, listeners } = await setup({ dark: false });
  theme.stop();
  assert.equal(listeners.length, 0);
  flipScheme(true);
  assert.equal(root.dataset.tdfTheme, 'light');
});

test('nothing is applied before load', () => {
  const win = new Window();
  const root = win.document.documentElement;
  const theme = createTheme({ win, settings: fakeSettings(), root });
  assert.equal(theme.current(), null);
  assert.equal(root.dataset.tdfTheme, undefined);
});

test('theme.css fades under the class theme.js sets, and defines both token sets on <html>', () => {
  const css = readFileSync(new URL('../src/core/theme.css', import.meta.url), 'utf8');
  assert.match(css, new RegExp(`\\.${FADE_CLASS} \\*,`));
  for (const name of ['light', 'dark']) assert.match(css, new RegExp(`:root\\[data-tdf-theme="${name}"\\] \\{`));
});

test('TDF-0012: public rows have no hover tint, and whispers keep their background', () => {
  const css = readFileSync(new URL('../src/core/theme.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /\.tdf-msg:hover/);
  assert.match(css, /#tdf-chat \.tdf-kind-whisper \{[^}]*\bbackground(-color)?\s*:/);
});

test('TDF-0020: whisperable names turn the whisper blue and hint after the time', () => {
  const css = readFileSync(new URL('../src/core/theme.css', import.meta.url), 'utf8');
  for (const name of ['light', 'dark']) {
    assert.match(css, new RegExp(`:root\\[data-tdf-theme="${name}"\\] \\{[^}]*--tdf-whisper-fg:`));
  }
  assert.doesNotMatch(css, /\.tdf-user \{[^}]*cursor/);
  assert.match(css, /\.tdf-whisperable \{[^}]*cursor: pointer/);
  assert.match(css, /\.tdf-whisperable:is\(:hover, :focus-visible\) \{[^}]*color: var\(--tdf-whisper-fg\)/);
  assert.match(
    css,
    /\.tdf-whisperable:is\(:hover, :focus-visible\) \+ \.tdf-time::after \{[^}]*content: " \(whisper\)"/,
  );
  const composer = readFileSync(new URL('../src/features/composer/composer.css', import.meta.url), 'utf8');
  assert.doesNotMatch(composer, /#2f81f7/i);
  assert.match(composer, /var\(--tdf-whisper-fg\)/);
});
