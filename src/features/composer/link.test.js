import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLabelledLink, isSingleHttpUrl } from './link.js';

const SMILIES = [':)', ';)', ':P', ':7', ';(', ':(', ':V', '[(', '[x', ':h', '*R', '8)', ':d', ':L', ':o'];

/** The href's value, between `href=` and the first space. */
const href = (/** @type {string} */ link) => /href=(\S+) /.exec(link)?.[1] ?? '';

test('isSingleHttpUrl accepts one http(s) URL and nothing else', () => {
  assert.equal(isSingleHttpUrl('https://example.com/a'), true);
  assert.equal(isSingleHttpUrl('HTTP://example.com'), true);
  assert.equal(isSingleHttpUrl('ftp://example.com'), false);
  assert.equal(isSingleHttpUrl('javascript:alert(1)'), false);
  assert.equal(isSingleHttpUrl('example.com'), false);
  assert.equal(isSingleHttpUrl('https://a.com https://b.com'), false);
  assert.equal(isSingleHttpUrl('see https://a.com'), false);
  assert.equal(isSingleHttpUrl('https://'), false);
  assert.equal(isSingleHttpUrl(''), false);
});

test('buildLabelledLink emits a protocol-relative, unquoted link', () => {
  assert.equal(
    buildLabelledLink('https://example.com/a/b?q=1&r=2#top', 'docs'),
    '[[a href=//example.com/a/b?q=1&r=2#top target=_blank]]docs[[/a]]',
  );
  assert.equal(buildLabelledLink('http://example.com', 'x'), '[[a href=//example.com/ target=_blank]]x[[/a]]');
});

test('buildLabelledLink percent-encodes the locked set plus @ and |', () => {
  const link = buildLabelledLink("https://example.com/p(1);a:b[c]*d'e\"f@g|h?q=(x)#f:)", 'x');
  assert.ok(link);
  const value = href(link);
  assert.equal(value, '//example.com/p%281%29%3Ba%3Ab%5Bc%5D%2Ad%27e%22f%40g%7Ch?q=%28x%29#f%3A%29');
  assert.doesNotMatch(value, /[()[\];:*'"@|\s]/);
});

test('a (film_2008) path forms no smilie', () => {
  const link = buildLabelledLink('https://en.wikipedia.org/wiki/Heat_(film_2008)', 'Heat');
  assert.ok(link);
  for (const smilie of SMILIES) assert.ok(!href(link).includes(smilie), `href contains ${smilie}`);
  assert.equal(href(link), '//en.wikipedia.org/wiki/Heat_%28film_2008%29');
});

test('a URL with quotes or ]] cannot break out of the tag', () => {
  for (const url of ['https://a.com/x"onmouseover=alert(1)', "https://a.com/x'y", 'https://a.com/x]]<b>[[', 'https://a.com/x>y<z']) {
    const link = buildLabelledLink(url, 'label');
    assert.ok(link, url);
    // Exactly the two tags, and the href holds no tag or attribute delimiter.
    assert.equal(link.split('[[').length - 1, 2, url);
    assert.equal(link.split(']]').length - 1, 2, url);
    assert.doesNotMatch(href(link), /["'<>[\]\s]/, url);
  }
});

test('buildLabelledLink rejects non-http(s) URLs', () => {
  assert.equal(buildLabelledLink('ftp://example.com/', 'x'), null);
  assert.equal(buildLabelledLink('javascript:alert(1)', 'x'), null);
  assert.equal(buildLabelledLink('//example.com/', 'x'), null);
  assert.equal(buildLabelledLink('not a url', 'x'), null);
});

test('buildLabelledLink rejects userinfo, explicit ports and IPv6 hosts', () => {
  assert.equal(buildLabelledLink('https://user@example.com/', 'x'), null);
  assert.equal(buildLabelledLink('https://user:pw@example.com/', 'x'), null);
  assert.equal(buildLabelledLink('https://:pw@example.com/', 'x'), null);
  assert.equal(buildLabelledLink('https://example.com:7000/', 'x'), null);
  assert.equal(buildLabelledLink('https://[2001:db8::1]/', 'x'), null);
});

test('buildLabelledLink falls back for a label the linkers or tags would rewrite', () => {
  for (const label of ['a[[b', 'a]]b', 'two\nlines', 'cr\rhere', 'see https://x.com', 'HTTP://x', 'me@example.com', 'ends[', '', '   ']) {
    assert.equal(buildLabelledLink('https://example.com/', label), null, JSON.stringify(label));
  }
  assert.equal(
    buildLabelledLink('https://example.com/', "it's [b]bold[/b]"),
    "[[a href=//example.com/ target=_blank]]it's [b]bold[/b][[/a]]",
  );
});

// The engine round trip: addMessage's escaping (message.js.php:87-94), then the render
// transform with the room's smilies, then the overlay's sanitiser — as a second client sees it.
test('a generated link renders as a link to its https target after the engine round trip', async () => {
  const { Window } = await import('happy-dom');
  const { expand } = await import('../../core/expand.js');
  const { sanitize } = await import('../../core/sanitize.js');
  const { document } = new Window({ url: 'https://chat.example.com/forum/chat/' });
  const escape = (/** @type {string} */ s) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&#60;').replace(/>/g, '&#62;').replace(/`/g, '&#96;')
      .replace(/'/g, '&#39;').replace(/"/g, '&#34;').replace(/%/g, '&#37;').replace(/\|/g, '&#127;');
  const smilie = (/** @type {string} */ s) => SMILIES.reduce((acc, sm) => acc.split(sm).join('<img alt="smilie">'), s);
  const cases = [
    ['https://en.wikipedia.org/wiki/Heat_(film_2008)', 'Heat', '/wiki/Heat_%28film_2008%29'],
    ["https://example.com/a'b\"c?q=1&P=2;x#f:)", "it's", '/a%27b%22c?q=1&P=2%3Bx#f%3A%29'],
  ];
  for (const [url, label, path] of cases) {
    const link = buildLabelledLink(url, label);
    assert.ok(link, url);
    const html = expand(escape(`before ${link} after`), { smilie });
    const holder = document.createElement('div');
    holder.appendChild(sanitize(html, /** @type {any} */ (document)));
    const anchors = holder.querySelectorAll('a');
    assert.equal(anchors.length, 1, html);
    assert.equal(anchors[0].textContent, label, html);
    assert.equal(holder.querySelectorAll('img').length, 0, html);
    // happy-dom ends an unquoted attribute value at `=`, which the HTML spec does not, so the
    // href is read as a browser reads it: up to whitespace or `>`, character references decoded.
    const raw = /<a href=([^\s>]+) target=_blank>/.exec(html)?.[1];
    assert.ok(raw, html);
    const decoded = raw.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
    const target = new URL(decoded, 'https://chat.example.com/forum/chat/');
    assert.equal(target.protocol, 'https:');
    assert.equal(target.pathname + target.search + target.hash, path);
  }
});
