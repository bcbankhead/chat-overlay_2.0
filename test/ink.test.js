import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { adapt, contrastRatio, MIN_CONTRAST, parseColor, THEME_BG } from '../src/core/ink.js';

test('parseColor reads #rgb, #rrggbb and rgb(); anything else is null', () => {
  assert.deepEqual(parseColor('#fff'), [1, 1, 1]);
  assert.deepEqual(parseColor('#000000'), [0, 0, 0]);
  assert.deepEqual(parseColor('rgb(255, 0, 0)'), [1, 0, 0]);
  assert.equal(parseColor('teal'), null);
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

test('every shifted colour reaches the minimum contrast on both themes', () => {
  const samples = ['#003366', '#ff69b4', '#ffff00', '#00ff00', '#0000ff', '#ff0000', '#800080', '#cc6600', '#66ccff', '#336633'];
  for (const bg of Object.values(THEME_BG)) {
    for (const color of samples) {
      const shown = adapt(color, bg);
      if (shown === '') continue;
      assert.ok(contrastRatio(parseColor(shown), parseColor(bg)) >= MIN_CONTRAST, `${color} on ${bg} → ${shown}`);
    }
  }
});

test('drift: THEME_BG matches each theme\'s --tdf-bg in theme.css', () => {
  const css = readFileSync(new URL('../src/core/theme.css', import.meta.url), 'utf8');
  for (const theme of /** @type {const} */ (['light', 'dark'])) {
    const block = new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([^}]*)\\}`).exec(css);
    assert.ok(block, `no ${theme} block in theme.css`);
    const bg = /--tdf-bg:\s*([^;]+);/.exec(block[1]);
    assert.ok(bg, `no --tdf-bg in the ${theme} block`);
    assert.equal(bg[1].trim().toLowerCase(), THEME_BG[theme]);
  }
});
