// The forum pages' navbar (TDF-0028): the Chat link and the "Chatting users" list move from
// the online-list block into a row under the breadcrumbs, and the navbar block leaves
// #page-header so `position: sticky` keeps it pinned after the header scrolls away. Each step
// works on whatever the page has and skips the rest; nothing here throws on a missing element.
// A row already built — by this include or by the Tampermonkey copy (`tm-` ids) — stops a
// second one.

import { installSearch } from './searchModal.js';

export const ROW_ID = 'tdf-chat-row';
export const USERS_ID = 'tdf-chatting-users';
export const STICKY_CLASS = 'tdf-sticky-nav';
export const STYLE_ID = 'tdf-forum-style';
/** The Tampermonkey userscript's row, which this include defers to. */
const LEGACY_ROW_ID = 'tm-chat-row';
const USERS_LABEL = /Chatting users:/;
const TEXT_NODE = 3;

/**
 * The `#nav-main` item whose own link reads exactly `Chat`.
 * @param {Element} nav
 * @returns {Element | null}
 */
function findChatItem(nav) {
  for (const li of nav.children) {
    if (li.tagName !== 'LI') continue;
    for (const a of li.children) if (a.tagName === 'A' && a.textContent?.trim() === 'Chat') return li;
  }
  return null;
}

/**
 * The "Chatting users:" line of the online-list paragraph: the label's text node and its
 * siblings up to, not including, the next `<br>`. The `<br>` just before the label is removed, or
 * the one after it when the label opens the paragraph, so no stray break is left behind.
 * @param {Document} doc
 * @returns {ChildNode[]}
 */
function findChattingUsers(doc) {
  for (const p of doc.querySelectorAll('.stat-block.online-list p')) {
    const nodes = [...p.childNodes];
    const start = nodes.findIndex((n) => n.nodeType === TEXT_NODE && USERS_LABEL.test(n.textContent ?? ''));
    if (start === -1) continue;
    const end = nodes.findIndex((n, i) => i > start && n.nodeName === 'BR');
    if (nodes[start - 1]?.nodeName === 'BR') nodes[start - 1].remove();
    else if (start === 0 && end !== -1) nodes[end].remove();
    return nodes.slice(start, end === -1 ? undefined : end);
  }
  return [];
}

/**
 * Build the chat row under `#nav-breadcrumbs` (or after `#nav-main` without them). The row is
 * inserted only when it has something in it.
 * @param {Document} doc
 * @returns {Element | null} the row, or null when none was inserted
 */
export function buildChatRow(doc) {
  if (doc.getElementById(ROW_ID) || doc.getElementById(LEGACY_ROW_ID)) return null;
  const nav = doc.getElementById('nav-main');
  if (!nav) return null;
  const row = newRow(doc);
  const chat = findChatItem(nav);
  if (chat) row.appendChild(chat);
  const users = findChattingUsers(doc);
  if (users.length) {
    const li = doc.createElement('li');
    li.id = USERS_ID;
    li.append(...users);
    row.appendChild(li);
  }
  if (!row.children.length) return null;
  placeRow(doc, nav, row);
  return row;
}

/**
 * The row other items join (TDF-0029): this include's, else the Tampermonkey copy's, else a new
 * empty one in the place buildChatRow uses.
 * @param {Document} doc
 * @returns {Element | null} null only without `#nav-main`
 */
export function chatRow(doc) {
  const existing = doc.getElementById(ROW_ID) ?? doc.getElementById(LEGACY_ROW_ID);
  if (existing) return existing;
  const nav = doc.getElementById('nav-main');
  if (!nav) return null;
  const row = newRow(doc);
  placeRow(doc, nav, row);
  return row;
}

/** @param {Document} doc */
function newRow(doc) {
  const row = doc.createElement('ul');
  row.id = ROW_ID;
  row.className = 'linklist navlinks';
  row.setAttribute('role', 'menubar');
  return row;
}

/**
 * Under `#nav-breadcrumbs`, or after `#nav-main` without them.
 * @param {Document} doc
 * @param {Element} nav
 * @param {Element} row
 */
function placeRow(doc, nav, row) {
  (doc.getElementById('nav-breadcrumbs') ?? nav).after(row);
}

/**
 * Move the navbar's `.custombg` block out of `#page-header` to sit right after it, and mark it
 * sticky. A block already outside the header (moved earlier, or by the Tampermonkey copy) is
 * left alone.
 * @param {Document} doc
 * @returns {boolean} whether the block was moved
 */
export function pinNavbar(doc) {
  const header = doc.getElementById('page-header');
  if (!header) return false;
  const anchor = doc.getElementById('nav-main') ?? header.querySelector('.navbar');
  const block = anchor?.closest('.custombg');
  if (!block || block === header || !header.contains(block)) return false;
  header.after(block);
  block.classList.add(STICKY_CLASS);
  return true;
}

/**
 * Add the include's style once, to `<head>` (or `<html>` before a head exists).
 * @param {Document} doc
 * @param {string} css
 */
export function injectStyle(doc, css) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = css;
  (doc.head ?? doc.documentElement).appendChild(style);
}

/**
 * Both DOM moves: the row and its search input (TDF-0029) first, so they travel with the navbar
 * block.
 * @param {Document} doc
 */
export function installForumNavbar(doc) {
  buildChatRow(doc);
  installSearch(doc, chatRow);
  pinNavbar(doc);
}
