import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { ROW_ID, chatRow, installForumNavbar } from '../src/forum/navbar.js';
import {
  FIXED_FIELDS,
  MODAL_ID,
  SEARCH_INPUT_ID,
  SEARCH_ITEM_ID,
  WILDCARD_NOTE,
  buildSearchModal,
  forumContext,
  installSearch,
  moreOptionsHref,
  searchParams,
  searchUrl,
} from '../src/forum/searchModal.js';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Cut down from the saved forum index and subforum pages (local/capture/forum/, untracked).
const SEARCH_BOX =
  '<div id="search-box" class="search-box search-header" role="search">' +
  '<form action="https://forum.example.com/forum/search.php" method="get" id="search">' +
  '<input name="keywords" id="keywords" type="search"></form></div>';
const INDEX_CRUMB =
  '<span class="crumb"><a href="./index.php" data-navbar-reference="index"><span>Board index</span></a></span>';
/** @param {string} id @param {string} name */
const forumCrumb = (id, name) =>
  `<span class="crumb" itemprop="itemListElement" data-forum-id="${id}"><a href="./viewforum.php?f=${id}" title="${name}"><span itemprop="name">${name}</span></a></span>`;
const SUBFORUM_CRUMBS = INDEX_CRUMB + forumCrumb('72', 'Other Love Doll Topics') + forumCrumb('11', 'Eye Candy!');
const INDEX = { pathname: '/forum/index.php', search: '' };
const SUBFORUM = { pathname: '/forum/viewforum.php', search: '?f=11' };

/**
 * @param {{ search?: boolean, crumbs?: string, row?: string, chat?: boolean }} [parts]
 */
function forumDoc({ search = true, crumbs = INDEX_CRUMB, row = '', chat = true } = {}) {
  const window = new Window();
  const { document } = window;
  const navMain = `<ul id="nav-main" class="nav-main linklist">${chat ? '<li><a href="/chat">Chat</a></li>' : ''}</ul>`;
  document.body.innerHTML =
    `<div id="page-header"><div class="custombg"><div class="headerbar">${search ? SEARCH_BOX : ''}</div></div>` +
    `<div class="custombg"><div class="navbar">${navMain}` +
    `<ul id="nav-breadcrumbs" class="nav-breadcrumbs linklist"><li class="breadcrumbs">${crumbs}</li></ul>${row}</div></div></div>`;
  return { window, document };
}

/** @param {Document} doc */
function parts(doc) {
  const input = /** @type {HTMLInputElement} */ (doc.getElementById(SEARCH_INPUT_ID));
  const backdrop = /** @type {HTMLElement} */ (doc.getElementById(MODAL_ID));
  const dialog = /** @type {HTMLElement} */ (backdrop.querySelector('[role="dialog"]'));
  const form = /** @type {HTMLFormElement} */ (dialog.querySelector('form'));
  const keywords = /** @type {HTMLInputElement} */ (form.querySelector('input[aria-label="Keywords"]'));
  const author = /** @type {HTMLInputElement} */ (form.querySelector('input[aria-label="Author"]'));
  const boxes = /** @type {HTMLInputElement[]} */ ([...form.querySelectorAll('input[type="checkbox"]')]);
  const more = /** @type {HTMLAnchorElement} */ (dialog.querySelector('a'));
  return { input, backdrop, dialog, form, keywords, author, boxes, more };
}

/**
 * The query the form would send: the submit event runs first, as a browser runs it before
 * building the form data.
 * @param {Window} window
 * @param {HTMLFormElement} form
 */
function submitted(window, form) {
  form.dispatchEvent(new window.Event('submit', { cancelable: true }));
  return new URLSearchParams(/** @type {any} */ (new window.FormData(form))).toString();
}

/** @param {Window} window @param {Element} target @param {string} key @param {boolean} [shiftKey] */
function press(window, target, key, shiftKey = false) {
  const e = new window.KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

const PAGE_SEARCH_URL = 'https://forum.example.com/forum/search.php';
const FIXED = FIXED_FIELDS.map(([k, v]) => `${k}=${v}`).join('&');

test('searchParams maps the fields: any term by default, author only when filled, fixed fields last', () => {
  const ctx = { id: '11', name: 'Eye Candy!' };
  assert.equal(
    searchParams({ keywords: 'red hair', allTerms: false, author: '', scoped: false }, ctx).toString(),
    `keywords=red+hair&terms=any&${FIXED}`,
  );
  assert.equal(
    searchParams({ keywords: 'red', allTerms: true, author: 'bob*', scoped: true }, ctx).toString(),
    `keywords=red&terms=all&author=bob*&fid%5B%5D=11&${FIXED}`,
  );
  assert.equal(searchParams({ keywords: 'x', allTerms: false, author: '', scoped: true }, null).get('fid[]'), null);
  assert.equal(FIXED, 'sc=1&sf=all&sr=posts&sk=t&sd=d&ch=300');
});

test('forumContext reads f from a viewforum URL and names it from its breadcrumb', () => {
  const { document } = forumDoc({ crumbs: SUBFORUM_CRUMBS });
  assert.deepEqual(forumContext(document, SUBFORUM), { id: '11', name: 'Eye Candy!' });
  assert.deepEqual(forumContext(document, { pathname: '/forum/viewforum.php', search: '?f=72' }), {
    id: '72',
    name: 'Other Love Doll Topics',
  });
});

test('forumContext falls back to the last breadcrumb on a topic URL without f', () => {
  const { document } = forumDoc({ crumbs: SUBFORUM_CRUMBS });
  assert.deepEqual(forumContext(document, { pathname: '/forum/viewtopic.php', search: '?t=5' }), {
    id: '11',
    name: 'Eye Candy!',
  });
});

test('forumContext names a forum with no breadcrumb "this forum", and reads a crumb without itemprop name', () => {
  const { window, document } = forumDoc({ crumbs: INDEX_CRUMB + '<span class="crumb" data-forum-id="5"><a> Plain </a></span>' });
  assert.deepEqual(forumContext(document, { pathname: '/forum/viewforum.php', search: '?f=9' }), { id: '9', name: '' });
  assert.deepEqual(forumContext(document, INDEX), { id: '5', name: 'Plain' });
  installSearch(document, chatRow, { pathname: '/forum/viewforum.php', search: '?f=9' });
  assert.ok(parts(document).dialog.textContent?.includes('Search only in this forum'));
  assert.equal(submitted(window, parts(document).form).includes('fid%5B%5D=9'), true);
});

test('forumContext is null on the index, and ignores f on other pages or when not a number', () => {
  const { document } = forumDoc();
  assert.equal(forumContext(document, INDEX), null);
  assert.equal(forumContext(document, { pathname: '/forum/search.php', search: '?f=11' }), null);
  assert.equal(forumContext(document, { pathname: '/forum/viewforum.php', search: '?f=abc' }), null);
});

test('the modal is a hidden aria-modal dialog with a GET form to relative search.php', () => {
  const { document } = forumDoc();
  const { backdrop, dialog } = buildSearchModal(document, null);
  const form = /** @type {HTMLFormElement} */ (dialog.querySelector('form'));
  assert.equal(backdrop.hidden, true);
  assert.equal(dialog.getAttribute('role'), 'dialog');
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  assert.equal(form.getAttribute('method'), 'get');
  assert.equal(form.getAttribute('action'), 'search.php');
  assert.ok(dialog.textContent?.includes(WILDCARD_NOTE));
  assert.ok(dialog.textContent?.includes('Match all terms'));
});

test('on the index: no forum box, and the form sends any-term keywords across all forums', () => {
  const { window, document } = forumDoc();
  installSearch(document, chatRow, INDEX);
  const { input, form, boxes } = parts(document);
  assert.equal(boxes.length, 1);
  input.value = 'red hair';
  input.dispatchEvent(new window.Event('focus'));
  assert.equal(submitted(window, form), `keywords=red+hair&terms=any&${FIXED}`);
});

test('in a subforum the search is scoped by default, and unticking it searches all forums', () => {
  const { window, document } = forumDoc({ crumbs: SUBFORUM_CRUMBS });
  installSearch(document, chatRow, SUBFORUM);
  const { form, keywords, boxes, dialog } = parts(document);
  const scope = boxes[1];
  assert.ok(dialog.textContent?.includes('Search only in Eye Candy!'));
  assert.equal(scope.checked, true);
  keywords.value = 'red';
  assert.equal(submitted(window, form), `keywords=red&terms=any&fid%5B%5D=11&${FIXED}`);
  scope.checked = false;
  assert.equal(submitted(window, form), `keywords=red&terms=any&${FIXED}`);
});

test('"Match all terms" sends terms=all and a filled author is sent', () => {
  const { window, document } = forumDoc();
  installSearch(document, chatRow, INDEX);
  const { form, keywords, author, boxes } = parts(document);
  keywords.value = 'red';
  boxes[0].checked = true;
  boxes[0].dispatchEvent(new window.Event('change'));
  author.value = 'bob*';
  const expected = searchParams({ keywords: 'red', allTerms: true, author: 'bob*', scoped: false }, null);
  assert.equal(submitted(window, form), expected.toString());
});

test('the form data matches searchParams for the same values', () => {
  const { window, document } = forumDoc({ crumbs: SUBFORUM_CRUMBS });
  installSearch(document, chatRow, SUBFORUM);
  const { form, keywords, author } = parts(document);
  keywords.value = 'a b';
  author.value = 'carol';
  const ctx = forumContext(document, SUBFORUM);
  const expected = searchParams({ keywords: 'a b', allTerms: false, author: 'carol', scoped: true }, ctx);
  assert.equal(submitted(window, form), expected.toString());
});

test('"More options" is plain search.php, plus fid[] while the forum box is ticked', () => {
  assert.equal(moreOptionsHref(null, true), 'search.php');
  const { window, document } = forumDoc({ crumbs: SUBFORUM_CRUMBS });
  installSearch(document, chatRow, SUBFORUM);
  const { more, boxes, keywords, author } = parts(document);
  keywords.value = 'red';
  author.value = 'bob';
  assert.equal(more.getAttribute('href'), `${PAGE_SEARCH_URL}?fid%5B%5D=11`);
  boxes[1].checked = false;
  boxes[1].dispatchEvent(new window.Event('change'));
  assert.equal(more.getAttribute('href'), PAGE_SEARCH_URL);
});

test('searchUrl takes the page search box action, resolved and without its query', () => {
  const { document } = forumDoc();
  assert.equal(searchUrl(document), PAGE_SEARCH_URL);
  const window = new Window({ url: 'https://forum.example.com/forum/app.php/help/faq' });
  window.document.body.innerHTML =
    '<div id="search-box"><form action="../../search.php?sid=abc#x" method="get"></form></div>';
  assert.equal(searchUrl(window.document), 'https://forum.example.com/forum/search.php');
});

test('searchUrl falls back to relative search.php without an action, or one it cannot resolve', () => {
  const { document } = forumDoc({ search: false });
  assert.equal(searchUrl(document), 'search.php');
  document.body.innerHTML = '<div id="search-box"><form method="get"></form></div>';
  assert.equal(searchUrl(document), 'search.php');
  document.body.innerHTML = '<div id="search-box"><form action="./search.php"></form></div>';
  assert.equal(searchUrl(document), 'search.php');
});

test('the installed form submits to the page search box action', () => {
  const { document } = forumDoc();
  installSearch(document, chatRow, INDEX);
  assert.equal(parts(document).form.getAttribute('action'), PAGE_SEARCH_URL);
});

test('focusing the navbar input opens the modal with its text carried over and keywords focused', () => {
  const { document } = forumDoc();
  installSearch(document, chatRow, INDEX);
  const { input, backdrop, keywords } = parts(document);
  input.value = 'hello';
  input.focus();
  assert.equal(backdrop.hidden, false);
  assert.equal(keywords.value, 'hello');
  assert.equal(document.activeElement, keywords);
});

test('typing in the navbar input opens the modal', () => {
  const { window, document } = forumDoc();
  installSearch(document, chatRow, INDEX);
  const { input, backdrop, keywords } = parts(document);
  input.value = 'h';
  input.dispatchEvent(new window.Event('input'));
  assert.equal(backdrop.hidden, false);
  assert.equal(keywords.value, 'h');
});

test('input while the modal is open does not reset what was typed in it', () => {
  const { window, document } = forumDoc();
  installSearch(document, chatRow, INDEX);
  const { input, keywords } = parts(document);
  input.value = 'a';
  input.focus();
  keywords.value = 'abc';
  input.dispatchEvent(new window.Event('input'));
  assert.equal(keywords.value, 'abc');
});

test('Esc closes the modal and returns focus to the navbar input without reopening it', () => {
  const { window, document } = forumDoc();
  installSearch(document, chatRow, INDEX);
  const { input, backdrop, keywords } = parts(document);
  input.focus();
  const e = press(window, keywords, 'Escape');
  assert.equal(e.defaultPrevented, true);
  assert.equal(backdrop.hidden, true);
  assert.equal(document.activeElement, input);
});

test('a click on the backdrop closes the modal; a click inside the dialog does not', () => {
  const { window, document } = forumDoc();
  installSearch(document, chatRow, INDEX);
  const { input, backdrop, dialog } = parts(document);
  input.focus();
  dialog.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(backdrop.hidden, false);
  backdrop.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(backdrop.hidden, true);
  assert.equal(document.activeElement, input);
});

test('Tab and Shift+Tab wrap inside the dialog', () => {
  const { window, document } = forumDoc({ crumbs: SUBFORUM_CRUMBS });
  installSearch(document, chatRow, SUBFORUM);
  const { input, keywords, more } = parts(document);
  input.focus();
  assert.equal(press(window, keywords, 'Tab', true).defaultPrevented, true);
  assert.equal(document.activeElement, more);
  assert.equal(press(window, more, 'Tab').defaultPrevented, true);
  assert.equal(document.activeElement, keywords);
  const author = parts(document).author;
  author.focus();
  assert.equal(press(window, author, 'Tab').defaultPrevented, false);
});

test('Tab with focus outside the dialog moves it to the first control, Shift+Tab to the last', () => {
  const { window, document } = forumDoc();
  installSearch(document, chatRow, INDEX);
  const { input, backdrop, keywords, more } = parts(document);
  input.focus();
  /** @type {HTMLElement} */ (document.activeElement).blur();
  press(window, document.body, 'Tab');
  assert.equal(document.activeElement, keywords);
  /** @type {HTMLElement} */ (document.activeElement).blur();
  press(window, document.body, 'Tab', true);
  assert.equal(document.activeElement, more);
  /** @type {HTMLElement} */ (document.activeElement).blur();
  assert.equal(press(window, document.body, 'Escape').defaultPrevented, true);
  assert.equal(backdrop.hidden, true);
});

test('once closed, the modal no longer takes Tab or Esc from the page', () => {
  const { window, document } = forumDoc();
  installSearch(document, chatRow, INDEX);
  const { input, keywords } = parts(document);
  input.focus();
  press(window, keywords, 'Escape');
  assert.equal(press(window, document.body, 'Tab').defaultPrevented, false);
  assert.equal(press(window, document.body, 'Escape').defaultPrevented, false);
});

test('clicking the navbar input after the modal closes opens it again', () => {
  const { window, document } = forumDoc();
  installSearch(document, chatRow, INDEX);
  const { input, backdrop, keywords } = parts(document);
  input.focus();
  press(window, keywords, 'Escape');
  assert.equal(document.activeElement, input);
  input.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(backdrop.hidden, false);
  assert.equal(document.activeElement, keywords);
});

test('a page without #nav-main gets no input and no modal', () => {
  const { document } = forumDoc();
  document.getElementById('nav-main')?.remove();
  assert.equal(installSearch(document, chatRow, INDEX), null);
  assert.equal(document.getElementById(SEARCH_ITEM_ID), null);
  assert.equal(document.getElementById(MODAL_ID), null);
});

test('the input is right-aligned in the chat row, which travels with the sticky navbar', () => {
  const { document } = forumDoc();
  installForumNavbar(document);
  const item = document.getElementById(SEARCH_ITEM_ID);
  assert.equal(item?.parentElement?.id, ROW_ID);
  assert.ok(item?.classList.contains('rightside'));
  assert.equal(item?.closest('.custombg')?.previousElementSibling?.id, 'page-header');
  assert.equal(document.getElementById(MODAL_ID)?.parentElement, document.body);
});

test('without the page\'s own #search-box (a guest without search permission) nothing is added', () => {
  const { document } = forumDoc({ search: false });
  installForumNavbar(document);
  assert.equal(document.getElementById(SEARCH_ITEM_ID), null);
  assert.equal(document.getElementById(MODAL_ID), null);
});

test('with no chat row built, the input gets a row of its own under the breadcrumbs', () => {
  const { document } = forumDoc({ chat: false });
  installSearch(document, chatRow, INDEX);
  const row = document.getElementById(ROW_ID);
  assert.equal(document.getElementById('nav-breadcrumbs')?.nextElementSibling, row);
  assert.equal(row?.firstElementChild?.id, SEARCH_ITEM_ID);
});

test("the Tampermonkey copy's row takes the input rather than a second row being added", () => {
  const { document } = forumDoc({ row: '<ul id="tm-chat-row" class="linklist navlinks"><li>Chat</li></ul>' });
  installForumNavbar(document);
  assert.equal(document.getElementById(ROW_ID), null);
  assert.equal(document.getElementById(SEARCH_ITEM_ID)?.parentElement?.id, 'tm-chat-row');
});

test('installing twice adds one input and one modal', () => {
  const { document } = forumDoc();
  installForumNavbar(document);
  assert.equal(installSearch(document, chatRow, INDEX), null);
  installForumNavbar(document);
  assert.equal(document.querySelectorAll(`#${SEARCH_ITEM_ID}`).length, 1);
  assert.equal(document.querySelectorAll(`#${MODAL_ID}`).length, 1);
});

test('forum.css hides the closed modal and lifts it above the sticky navbar', () => {
  const css = readFileSync(path.join(repo, 'src', 'forum', 'forum.css'), 'utf8');
  assert.match(css, /\.tdf-search-backdrop\[hidden\]\s*\{[^}]*display:\s*none/);
  const z = Number(/\.tdf-search-backdrop\s*\{[^}]*z-index:\s*(\d+)/.exec(css)?.[1]);
  const navZ = Number(/\.tdf-sticky-nav\s*\{[^}]*z-index:\s*(\d+)/.exec(css)?.[1]);
  assert.ok(z > navZ);
});
