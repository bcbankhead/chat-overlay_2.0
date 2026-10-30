import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { build } from '../build.mjs';
import {
  ROW_ID,
  STICKY_CLASS,
  STYLE_ID,
  USERS_ID,
  buildChatRow,
  injectStyle,
  installForumNavbar,
  pinNavbar,
} from '../src/forum/navbar.js';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const NAV_MAIN = '<ul id="nav-main" class="nav-main linklist"><li><a href="/faq">FAQ</a></li><li><a href="/chat">Chat</a></li></ul>';
const BREADCRUMBS = '<ul id="nav-breadcrumbs" class="nav-breadcrumbs linklist"><li>Board index</li></ul>';
const ONLINE =
  '<div class="stat-block online-list"><h3>Who is online</h3>' +
  '<p>In total there are 3 users online<br>Registered users: <a>carol</a><br>Chatting users: <a>alice</a>, <a>bob</a></p></div>';

/**
 * A forum page built from parts, so each test can leave one out.
 * @param {{ navMain?: string, breadcrumbs?: string, online?: string, header?: boolean }} [parts]
 */
function forumHtml({ navMain = NAV_MAIN, breadcrumbs = BREADCRUMBS, online = ONLINE, header = true } = {}) {
  const navbar = `<div class="custombg"><div class="navbar">${navMain}${breadcrumbs}</div></div>`;
  const top = header ? `<div id="page-header"><div class="headerbar">Logo</div>${navbar}</div>` : navbar;
  return `${top}<div id="page-body">${online}</div>`;
}

/** @param {Parameters<typeof forumHtml>[0]} [parts] */
function forumDoc(parts) {
  const { document } = new Window();
  document.body.innerHTML = forumHtml(parts);
  return document;
}

test('the row sits under the breadcrumbs with the Chat item, then the chatting users in order', () => {
  const doc = forumDoc();
  const row = buildChatRow(doc);
  assert.ok(row);
  assert.equal(row.id, ROW_ID);
  assert.equal(row.className, 'linklist navlinks');
  assert.equal(row.getAttribute('role'), 'menubar');
  assert.equal(doc.getElementById('nav-breadcrumbs')?.nextElementSibling, row);
  assert.equal(row.children.length, 2);
  assert.equal(row.children[0].querySelector('a')?.textContent, 'Chat');
  assert.equal(row.children[1].id, USERS_ID);
  assert.equal(row.children[1].textContent, 'Chatting users: alice, bob');
  assert.equal(doc.querySelector('#nav-main')?.textContent, 'FAQ');
  assert.equal(doc.querySelector('.online-list p')?.textContent, 'In total there are 3 users onlineRegistered users: carol');
});

test('without breadcrumbs the row goes right after #nav-main', () => {
  const doc = forumDoc({ breadcrumbs: '' });
  const row = buildChatRow(doc);
  assert.ok(row);
  assert.equal(doc.getElementById('nav-main')?.nextElementSibling, row);
});

test('a "Chat" link nested deeper, or with other text, is not taken', () => {
  const doc = forumDoc({
    navMain: '<ul id="nav-main"><li><span><a>Chat</a></span></li><li><a>Chat room</a></li></ul>',
  });
  const row = buildChatRow(doc);
  assert.deepEqual([...(row?.children ?? [])].map((li) => li.id), [USERS_ID]);
  assert.equal(doc.querySelectorAll('#nav-main > li').length, 2);
});

test('the navbar block leaves #page-header to sit right after it, marked sticky', () => {
  const doc = forumDoc();
  const header = doc.getElementById('page-header');
  assert.equal(pinNavbar(doc), true);
  const block = header?.nextElementSibling;
  assert.ok(block?.classList.contains('custombg'));
  assert.ok(block?.classList.contains(STICKY_CLASS));
  assert.ok(block?.querySelector('#nav-main'));
  assert.equal(header?.querySelector('.custombg'), null);
});

test('installing moves the row along with the navbar block', () => {
  const doc = forumDoc();
  installForumNavbar(doc);
  assert.equal(doc.getElementById(ROW_ID)?.closest('.custombg')?.previousElementSibling?.id, 'page-header');
});

test('a second run adds no row and moves nothing', () => {
  const doc = forumDoc();
  installForumNavbar(doc);
  const html = doc.body.innerHTML;
  installForumNavbar(doc);
  assert.equal(doc.body.innerHTML, html);
  assert.equal(doc.querySelectorAll(`#${ROW_ID}`).length, 1);
  assert.equal(doc.querySelectorAll(`.${STICKY_CLASS}`).length, 1);
});

test("after the Tampermonkey copy has run, its row stands and the block is not moved again", () => {
  const doc = forumDoc();
  const header = doc.getElementById('page-header');
  const block = doc.querySelector('.custombg');
  const tmRow = doc.createElement('ul');
  tmRow.id = 'tm-chat-row';
  tmRow.appendChild(/** @type {Element} */ (doc.querySelector('#nav-main li:last-child')));
  doc.getElementById('nav-breadcrumbs')?.after(tmRow);
  header?.after(/** @type {Element} */ (block));
  block?.classList.add('tm-sticky-nav');
  const html = doc.body.innerHTML;
  installForumNavbar(doc);
  assert.equal(doc.body.innerHTML, html);
  assert.equal(doc.getElementById(ROW_ID), null);
});

test('a page missing #nav-main still pins the navbar and builds no row', () => {
  const doc = forumDoc({ navMain: '' });
  assert.doesNotThrow(() => installForumNavbar(doc));
  assert.equal(doc.getElementById(ROW_ID), null);
  assert.ok(doc.getElementById('page-header')?.nextElementSibling?.classList.contains(STICKY_CLASS));
});

test('a page without the Chat link builds the row from the chatting users alone', () => {
  const doc = forumDoc({ navMain: '<ul id="nav-main"><li><a>FAQ</a></li></ul>' });
  installForumNavbar(doc);
  const row = doc.getElementById(ROW_ID);
  assert.equal(row?.children.length, 1);
  assert.equal(row?.children[0].id, USERS_ID);
});

test('a page without the online list builds the row from the Chat item alone', () => {
  const doc = forumDoc({ online: '' });
  installForumNavbar(doc);
  const row = doc.getElementById(ROW_ID);
  assert.equal(row?.children.length, 1);
  assert.equal(row?.children[0].querySelector('a')?.textContent, 'Chat');
});

test('only the chatting-users line moves; what follows it stays, and the <br> before it goes', () => {
  const doc = forumDoc({
    online:
      '<div class="stat-block online-list"><h3>Who is online</h3>' +
      '<p>Registered users: <a>carol</a><br>Chatting users: <a>alice</a>, <a>bob</a><br><em>Legend: Admins</em></p></div>',
  });
  installForumNavbar(doc);
  const users = doc.getElementById(USERS_ID);
  assert.equal(users?.textContent, 'Chatting users: alice, bob');
  assert.equal(users?.querySelector('br, em'), null);
  const p = doc.querySelector('.online-list p');
  assert.equal(p?.innerHTML, 'Registered users: <a>carol</a><br><em>Legend: Admins</em>');
});

test('a chatting-users line that opens the paragraph takes the <br> after it', () => {
  const doc = forumDoc({
    online:
      '<div class="stat-block online-list">' +
      '<p>Chatting users: <a>alice</a><br><em>Legend: Admins</em></p></div>',
  });
  installForumNavbar(doc);
  assert.equal(doc.getElementById(USERS_ID)?.textContent, 'Chatting users: alice');
  assert.equal(doc.querySelector('.online-list p')?.innerHTML, '<em>Legend: Admins</em>');
});

test('an online list without "Chatting users:" is left as it is', () => {
  const doc = forumDoc({ online: '<div class="stat-block online-list"><p>Registered users: <a>carol</a></p></div>' });
  installForumNavbar(doc);
  assert.equal(doc.getElementById(USERS_ID), null);
  assert.equal(doc.querySelector('.online-list p')?.textContent, 'Registered users: carol');
});

test('a page without #page-header builds the row and moves nothing', () => {
  const doc = forumDoc({ header: false });
  installForumNavbar(doc);
  assert.ok(doc.getElementById(ROW_ID));
  assert.equal(doc.querySelector(`.${STICKY_CLASS}`), null);
  assert.equal(pinNavbar(doc), false);
});

test('an empty page throws nothing and changes nothing', () => {
  const { document } = new Window();
  assert.doesNotThrow(() => installForumNavbar(document));
  assert.equal(document.body.innerHTML, '');
});

test('a #nav-main child that is not a list item is not taken for the Chat item', () => {
  const doc = forumDoc({ navMain: '<ul id="nav-main"><div><a>Chat</a></div></ul>' });
  const row = buildChatRow(doc);
  assert.deepEqual([...(row?.children ?? [])].map((li) => li.id), [USERS_ID]);
  assert.ok(doc.querySelector('#nav-main > div > a'));
});

test('a navbar that is not inside a .custombg block is not moved', () => {
  const { document } = new Window();
  document.body.innerHTML = `<div id="page-header"><div class="navbar">${NAV_MAIN}</div></div>`;
  assert.equal(pinNavbar(document), false);
  assert.ok(document.getElementById('page-header')?.querySelector('#nav-main'));
});

test('a #page-header that is itself the .custombg block is not moved', () => {
  const { document } = new Window();
  document.body.innerHTML = `<div id="page-header" class="custombg"><div class="navbar">${NAV_MAIN}</div></div>`;
  assert.equal(pinNavbar(document), false);
  assert.equal(document.querySelector(`.${STICKY_CLASS}`), null);
});

test('without a <head>, the style goes on <html>', () => {
  const { document } = new Window();
  document.head.remove();
  injectStyle(document, 'a {}');
  assert.equal(document.getElementById(STYLE_ID)?.parentNode, document.documentElement);
});

test("forum.css styles the ids and classes navbar.js writes", () => {
  const css = readFileSync(path.join(repo, 'src', 'forum', 'forum.css'), 'utf8');
  assert.match(css, new RegExp(`#${USERS_ID}\\s*\\{[^}]*display:\\s*inline-flex`));
  assert.match(css, new RegExp(`\\.${STICKY_CLASS}\\s*\\{[^}]*position:\\s*sticky[^}]*top:\\s*0`));
});

test('the style is added once, to <head>', () => {
  const { document } = new Window();
  injectStyle(document, 'a {}');
  injectStyle(document, 'b {}');
  const styles = document.querySelectorAll(`#${STYLE_ID}`);
  assert.equal(styles.length, 1);
  assert.equal(styles[0].parentNode, document.head);
  assert.equal(styles[0].textContent, 'a {}');
});

// The built bundle, as the forum header template loads it.
/** @type {string} */
let bundle;
/** @type {string} */
let out;
before(async () => {
  out = mkdtempSync(path.join(tmpdir(), 'tdf-forum-'));
  const { outputs } = await build({ match: 'https://chat.example.com/forum/chat/*', root: repo, outfile: path.join(out, 'tdf-chat.user.js') });
  bundle = readFileSync(outputs.forum, 'utf8');
});
after(() => rmSync(out, { recursive: true, force: true }));

/** A forum page whose document reports `state`, with the bundle not yet run. */
function bundlePage(state) {
  const window = new Window();
  const { document } = window;
  document.body.innerHTML = forumHtml();
  Object.defineProperty(document, 'readyState', { value: state, configurable: true });
  return { window, document };
}

test('placed in <head>, the bundle adds the style at once and moves nothing until DOMContentLoaded', () => {
  const { window, document } = bundlePage('loading');
  window.eval(bundle);
  assert.equal(document.getElementById(STYLE_ID)?.parentNode, document.head);
  assert.match(document.getElementById(STYLE_ID)?.textContent ?? '', new RegExp(`\\.${STICKY_CLASS}\\s*\\{[^}]*position:\\s*sticky`));
  assert.equal(document.getElementById(ROW_ID), null);
  assert.ok(document.getElementById('page-header')?.querySelector('.custombg'));
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  assert.ok(document.getElementById(ROW_ID));
  assert.ok(document.getElementById('page-header')?.nextElementSibling?.classList.contains(STICKY_CLASS));
});

test('placed at the end of <body>, the bundle adds the style and moves the navbar right away', () => {
  const { window, document } = bundlePage('interactive');
  window.eval(bundle);
  assert.ok(document.getElementById(STYLE_ID));
  assert.ok(document.getElementById(ROW_ID));
  assert.ok(document.getElementById('page-header')?.nextElementSibling?.classList.contains(STICKY_CLASS));
});

test('the bundle loaded twice gives one style, one row and one move', () => {
  const { window, document } = bundlePage('loading');
  window.eval(bundle);
  window.eval(bundle);
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  assert.equal(document.querySelectorAll(`#${STYLE_ID}`).length, 1);
  assert.equal(document.querySelectorAll(`#${ROW_ID}`).length, 1);
  assert.equal(document.querySelectorAll(`.${STICKY_CLASS}`).length, 1);
});

test('the bundle loaded twice on a page with #search-box gives one search input and one modal', () => {
  const { window, document } = bundlePage('loading');
  document.getElementById('page-header')?.insertAdjacentHTML('afterbegin', '<div id="search-box"></div>');
  window.eval(bundle);
  window.eval(bundle);
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  assert.equal(document.querySelectorAll('#tdf-search-input').length, 1);
  assert.equal(document.querySelectorAll('#tdf-search-modal').length, 1);
  assert.equal(document.getElementById('tdf-search')?.parentElement?.id, ROW_ID);
});
