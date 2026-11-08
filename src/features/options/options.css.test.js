import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const css = readFileSync(new URL('./options.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, sel, body]) => ({
  selectors: sel.split(',').map((s) => s.trim().replace(/\s+/g, ' ')),
  body: body.replace(/\s+/g, ' ').trim(),
}));

test('the version credit is hidden at rest and shown on hover or keyboard focus, and the number never hides', () => {
  const rest = rules.find((r) => r.selectors.length === 1 && r.selectors[0] === '#tdf-rail .tdf-opt-version-by');
  assert.ok(rest, 'a rule targets the credit at rest');
  assert.match(rest.body, /(^|; )display: none;/, 'the credit is hidden at rest');

  const reveal = rules.find(
    (r) =>
      r.selectors.includes('#tdf-rail .tdf-opt-version:hover .tdf-opt-version-by') &&
      r.selectors.includes('#tdf-rail .tdf-opt-version:focus-visible .tdf-opt-version-by'),
  );
  assert.ok(reveal, 'one rule reveals the credit on both hover and focus-visible');
  assert.match(reveal.body, /(^|; )display: inline;/, 'the credit is shown inline');

  for (const r of rules) {
    if (!r.selectors.some((s) => s.includes('.tdf-opt-version-num'))) continue;
    assert.doesNotMatch(r.body, /display: none|visibility: hidden|opacity: 0(;|$)/, `${r.selectors.join(', ')} hides the version number`);
  }
});

test('the User options subheading is its own rule, with no border, unlike a section header', () => {
  const sub = rules.find((r) => r.selectors.length === 1 && r.selectors[0] === '#tdf-rail .tdf-opt-subsection');
  assert.ok(sub, 'a rule targets the subheading');
  assert.doesNotMatch(sub.body, /border/, 'no rule line');
  const section = rules.find((r) => r.selectors.length === 1 && r.selectors[0] === '#tdf-rail .tdf-opt-section');
  assert.match(String(section?.body), /border-top:/, 'a section header keeps its rule');
});
