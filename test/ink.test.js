import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { adapt, THEME_BG, themeInk } from '../src/core/ink.js';

/** WCAG contrast of two `#rrggbb` colours, computed here independently of ink.js. */
function contrast(/** @type {string} */ a, /** @type {string} */ b) {
  const lum = (/** @type {string} */ hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lin = (/** @type {number} */ c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bl);
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

test('#rgb, #rrggbb and rgb() all parse; anything else is returned unchanged', () => {
  assert.equal(adapt('#00f', THEME_BG.dark), '#427aff');
  assert.equal(adapt('rgb(0, 0, 255)', THEME_BG.dark), '#427aff');
  assert.equal(adapt('#fff', THEME_BG.light), '');
  assert.equal(adapt('xrgb(0, 0, 0)', THEME_BG.light), 'xrgb(0, 0, 0)');
});

test('the spec vectors: dark blue lightens on dark, hot pink deepens on light', () => {
  assert.equal(adapt('#003366', THEME_BG.dark), '#5585be');
  assert.equal(adapt('#ff69b4', THEME_BG.light), '#cd3a89');
});

test('chroma is reduced only to stay in sRGB: pure blue on dark keeps its hue, lightened', () => {
  assert.equal(adapt('#0000ff', THEME_BG.dark), '#427aff');
});

test('a failing grey or black takes the theme text colour', () => {
  assert.equal(adapt('#000000', THEME_BG.dark), '');
  assert.equal(adapt('#ffffff', THEME_BG.light), '');
  assert.equal(adapt('#777777', THEME_BG.dark), '');
});

test('a colour with enough contrast is shown as chosen', () => {
  assert.equal(adapt('#cc0000', THEME_BG.light), '#cc0000');
  assert.equal(adapt('#000000', THEME_BG.light), '#000000');
  assert.equal(adapt('rgb(255, 255, 0)', THEME_BG.dark), 'rgb(255, 255, 0)');
});

test('an unparseable colour is returned unchanged', () => {
  assert.equal(adapt('teal', THEME_BG.dark), 'teal');
});

test('an unparseable background leaves the colour unchanged', () => {
  assert.equal(adapt('#003366', 'transparent'), '#003366');
});

test('an rgb() channel above 255 is clamped as painted', () => {
  // Clamped, rgb(0,0,999) paints as pure blue, which fails on dark and must shift.
  assert.equal(adapt('rgb(0, 0, 999)', THEME_BG.dark), '#427aff');
});

test('every shifted colour reaches the minimum contrast on both themes', () => {
  const samples = ['#003366', '#ff69b4', '#ffff00', '#00ff00', '#0000ff', '#ff0000', '#800080', '#cc6600', '#66ccff', '#336633'];
  for (const bg of Object.values(THEME_BG)) {
    for (const color of samples) {
      const shown = adapt(color, bg);
      if (shown === '') continue;
      const hex = shown.startsWith('#') ? shown : null;
      assert.ok(hex, `${color} on ${bg} kept unparsed as ${shown}`);
      assert.ok(contrast(hex, bg) >= 4.5, `${color} on ${bg} → ${shown}`);
    }
  }
});

test('themeInk paints the adapted colour, or the theme text colour for a failing grey', () => {
  assert.equal(themeInk('#003366', 'dark'), adapt('#003366', THEME_BG.dark));
  assert.equal(themeInk('#003366', 'light'), '#003366');
  assert.equal(themeInk('#000000', 'dark'), 'var(--tdf-fg)');
  assert.equal(themeInk('teal', 'light'), 'teal');
});

test('drift: THEME_BG matches each theme\'s --tdf-bg in theme.css', () => {
  const css = readFileSync(new URL('../src/core/theme.css', import.meta.url), 'utf8');
  for (const theme of /** @type {const} */ (['light', 'dark'])) {
    const block = new RegExp(`:root\\[data-tdf-theme="${theme}"\\]\\s*\\{([^}]*)\\}`).exec(css);
    assert.ok(block, `no ${theme} block in theme.css`);
    const bg = /--tdf-bg:\s*([^;]+);/.exec(block[1]);
    assert.ok(bg, `no --tdf-bg in the ${theme} block`);
    assert.equal(bg[1].trim().toLowerCase(), THEME_BG[theme]);
  }
});
