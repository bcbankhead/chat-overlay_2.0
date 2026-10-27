import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { expand } from '../src/core/expand.js';
import { sanitize } from '../src/core/sanitize.js';

const { document } = new Window();
const clean = (html) => {
  const div = document.createElement('div');
  div.appendChild(sanitize(html, document));
  return div;
};

test('a [[script]] message renders inert', () => {
  const div = clean(expand('[[script]]alert(1)[[/script]]'));
  assert.equal(div.querySelector('script'), null);
  assert.equal(div.textContent, 'alert(1)');
});

test('event handlers and javascript: urls are dropped', () => {
  const div = clean(
    '<img src="x.gif" onerror="alert(1)"><a href="javascript:alert(1)" onclick="x()">l</a><a href=" java\tscript:x">m</a>',
  );
  const img = div.querySelector('img');
  assert.equal(img.getAttribute('onerror'), null);
  assert.equal(img.getAttribute('src'), 'x.gif');
  for (const a of div.querySelectorAll('a')) {
    assert.equal(a.getAttribute('href'), null);
    assert.equal(a.getAttribute('onclick'), null);
  }
});

test('links are forced to a new tab without opener', () => {
  const a = clean('<a href="https://x.test" target="_self">x</a>').querySelector('a');
  assert.equal(a.getAttribute('href'), 'https://x.test');
  assert.equal(a.getAttribute('target'), '_blank');
  assert.equal(a.getAttribute('rel'), 'noopener noreferrer');
});

test('the share-plugin image survives', () => {
  const div = clean(
    expand(
      '[[br]][[a href="plugins/share/view.php?id=123456789012345" target="_blank"]][[img src="plugins/share/view.php?id=123456789012345" style="max-width:250px; max-height:250px;" border="0"]][[/a]]',
    ),
  );
  const img = div.querySelector('a > img');
  assert.ok(img);
  assert.equal(img.getAttribute('src'), 'plugins/share/view.php?id=123456789012345');
  assert.equal(img.getAttribute('style'), 'max-width: 250px; max-height: 250px');
  assert.equal(img.getAttribute('border'), null);
});

test('img src rejects data: and other schemes', () => {
  assert.equal(clean('<img src="data:image/svg+xml,x">').querySelector('img').getAttribute('src'), null);
});

test('style is filtered to the allowlisted properties', () => {
  const span = clean(
    '<span style="color:red; position:fixed; font-family: arial; background:url(x)">t</span>',
  ).querySelector('span');
  assert.equal(span.getAttribute('style'), 'color: red; font-family: arial');
});

test('disallowed elements are replaced by their text', () => {
  const div = clean('<iframe src="https://x.test"></iframe><div><b>bold</b></div><style>p{}</style>');
  assert.equal(div.querySelector('iframe'), null);
  assert.equal(div.querySelector('div'), null);
  assert.equal(div.querySelector('b'), null);
  assert.equal(div.textContent, 'boldp{}');
});
