// Forum search in the sticky navbar (TDF-0029): an input in the chat row opens a modal holding
// a subset of search.php — keywords, "Match all terms", author, and on a forum page a "Search only
// in <forum>" box — with the rest of search.php's options fixed as hidden fields. The form is a
// plain GET to the search.php the page's own #search-box form targets, so routed app.php pages
// resolve it correctly. Shown only where the page renders that #search-box, which phpBB leaves out
// for users without search permission.

export const SEARCH_ITEM_ID = 'tdf-search';
export const SEARCH_INPUT_ID = 'tdf-search-input';
export const MODAL_ID = 'tdf-search-modal';
export const SEARCH_URL = 'search.php';
export const WILDCARD_NOTE = 'Use * as a wildcard for partial matches.';
/** The search.php options the modal does not offer, in the order they are sent. */
export const FIXED_FIELDS = /** @type {const} */ ([
  ['sc', '1'],
  ['sf', 'all'],
  ['sr', 'posts'],
  ['sk', 't'],
  ['sd', 'd'],
  ['ch', '300'],
]);
const FORUM_PAGES = /\/(viewforum|viewtopic)\.php$/;
const FOCUSABLE = 'input:not([type="hidden"]):not([disabled]), button:not([disabled]), a[href]';

/** @typedef {{ id: string, name: string }} ForumContext */
/** @typedef {{ keywords: string, allTerms: boolean, author: string, scoped: boolean }} SearchValues */

/**
 * The forum the page is in: `f` from the URL on viewforum/viewtopic, else the last breadcrumb
 * carrying `data-forum-id`. Its name comes from the breadcrumb with that id. Null on the index.
 * @param {Document} doc
 * @param {{ pathname: string, search: string }} location
 * @returns {ForumContext | null}
 */
export function forumContext(doc, location) {
  const crumbs = [...doc.querySelectorAll('#nav-breadcrumbs .crumb[data-forum-id]')];
  const fromUrl = FORUM_PAGES.test(location.pathname) ? new URLSearchParams(location.search).get('f') : null;
  const id = fromUrl && /^\d+$/.test(fromUrl) ? fromUrl : crumbs.at(-1)?.getAttribute('data-forum-id');
  if (!id || !/^\d+$/.test(id)) return null;
  const crumb = crumbs.find((c) => c.getAttribute('data-forum-id') === id);
  const name = (crumb?.querySelector('[itemprop="name"]') ?? crumb)?.textContent?.trim() ?? '';
  return { id, name };
}

/**
 * search.php as the page's own #search-box form targets it, without its query (a GET form drops
 * it anyway, and "More options" adds its own). A bare relative `search.php` would resolve against
 * routed paths such as app.php/help/faq; it is the fallback only when the action is missing or
 * cannot be resolved.
 * @param {Document} doc
 * @returns {string}
 */
export function searchUrl(doc) {
  const action = doc.querySelector('#search-box form')?.getAttribute('action');
  if (!action) return SEARCH_URL;
  try {
    const url = new URL(action, doc.baseURI);
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return SEARCH_URL;
  }
}

/**
 * The query the modal submits: `author` only when filled in, `fid[]` only while scoped to a forum.
 * @param {SearchValues} values
 * @param {ForumContext | null} context
 * @returns {URLSearchParams}
 */
export function searchParams(values, context) {
  const params = new URLSearchParams();
  params.append('keywords', values.keywords);
  params.append('terms', values.allTerms ? 'all' : 'any');
  if (values.author) params.append('author', values.author);
  if (context && values.scoped) params.append('fid[]', context.id);
  for (const [name, value] of FIXED_FIELDS) params.append(name, value);
  return params;
}

/**
 * "More options": search.php itself, scoped while the forum box is ticked. Keywords and author
 * are never carried, since search.php runs a search as soon as it receives either.
 * @param {ForumContext | null} context
 * @param {boolean} scoped
 * @param {string} [url] search.php, as searchUrl resolves it
 * @returns {string}
 */
export function moreOptionsHref(context, scoped, url = SEARCH_URL) {
  return context && scoped ? `${url}?${new URLSearchParams([['fid[]', context.id]])}` : url;
}

/**
 * @param {Document} doc
 * @param {string} text
 * @param {HTMLInputElement} input
 */
function labelled(doc, text, input) {
  const label = doc.createElement('label');
  label.append(input, ` ${text}`);
  return label;
}

/**
 * The modal: a backdrop holding a dialog with a GET form to search.php. Built hidden.
 * @param {Document} doc
 * @param {ForumContext | null} context
 * @param {string} [url] search.php, as searchUrl resolves it
 */
export function buildSearchModal(doc, context, url = SEARCH_URL) {
  const backdrop = doc.createElement('div');
  backdrop.id = MODAL_ID;
  backdrop.className = 'tdf-search-backdrop';
  backdrop.hidden = true;

  const dialog = doc.createElement('div');
  dialog.className = 'tdf-search-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Search the forum');

  const form = doc.createElement('form');
  form.method = 'get';
  form.action = url;

  // The visible controls carry no names: the query is searchParams' alone, written into
  // `fields` as hidden inputs when the form submits.
  const keywords = doc.createElement('input');
  keywords.type = 'search';
  keywords.maxLength = 128;
  keywords.placeholder = 'Search for keywords';
  keywords.setAttribute('aria-label', 'Keywords');

  const allTerms = doc.createElement('input');
  allTerms.type = 'checkbox';

  const author = doc.createElement('input');
  author.type = 'search';
  author.placeholder = 'Author';
  author.setAttribute('aria-label', 'Author');
  const note = doc.createElement('p');
  note.className = 'tdf-search-note';
  note.textContent = WILDCARD_NOTE;

  form.append(keywords, labelled(doc, 'Match all terms', allTerms), author, note);

  const more = doc.createElement('a');
  more.textContent = 'More options';
  more.href = moreOptionsHref(context, true, url);
  /** @type {HTMLInputElement | null} */
  let scope = null;
  if (context) {
    const box = doc.createElement('input');
    box.type = 'checkbox';
    box.checked = true;
    box.addEventListener('change', () => (more.href = moreOptionsHref(context, box.checked, url)));
    form.append(labelled(doc, `Search only in ${context.name || 'this forum'}`, box));
    scope = box;
  }

  const fields = doc.createElement('div');
  fields.hidden = true;
  const submit = doc.createElement('button');
  submit.type = 'submit';
  submit.className = 'button';
  submit.textContent = 'Search';
  const actions = doc.createElement('div');
  actions.className = 'tdf-search-actions';
  actions.append(submit, more);
  form.append(fields, actions);

  form.addEventListener('submit', () => {
    const values = {
      keywords: keywords.value,
      allTerms: allTerms.checked,
      author: author.value,
      scoped: scope?.checked ?? false,
    };
    fields.replaceChildren(
      ...[...searchParams(values, context)].map(([name, value]) => {
        const hidden = doc.createElement('input');
        hidden.type = 'hidden';
        hidden.name = name;
        hidden.value = value;
        return hidden;
      }),
    );
  });

  dialog.append(form);
  backdrop.append(dialog);
  return { backdrop, dialog, keywords };
}

/**
 * The input in the chat row, and the modal it opens. Does nothing without the page's own
 * #search-box or when already installed.
 * @param {Document} doc
 * @param {(doc: Document) => Element | null} rowFor the row to join (navbar.js's chatRow),
 *   asked only once the input is going in
 * @param {{ pathname: string, search: string }} [location]
 * @returns {HTMLInputElement | null} the navbar input, or null when none was added
 */
export function installSearch(doc, rowFor, location = doc.location) {
  if (!doc.getElementById('search-box') || doc.getElementById(SEARCH_ITEM_ID)) return null;
  const row = rowFor(doc);
  if (!row) return null;

  const item = doc.createElement('li');
  item.id = SEARCH_ITEM_ID;
  item.className = 'rightside';
  const input = doc.createElement('input');
  input.id = SEARCH_INPUT_ID;
  input.type = 'search';
  input.className = 'inputbox search tiny';
  input.placeholder = 'Search…';
  input.setAttribute('aria-label', 'Search the forum');
  input.setAttribute('aria-haspopup', 'dialog');
  item.append(input);
  row.append(item);

  const modal = buildSearchModal(doc, forumContext(doc, location), searchUrl(doc));
  doc.body.append(modal.backdrop);

  // On the document while open, not the backdrop: a click on a part of the dialog that takes no
  // focus moves focus to body, where a backdrop listener would no longer see Esc or Tab.
  /** @param {KeyboardEvent} e */
  const onKeydown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      trapTab(modal.dialog, e);
    }
  };
  let returning = false;
  const open = () => {
    if (returning || !modal.backdrop.hidden) return;
    modal.keywords.value = input.value;
    modal.backdrop.hidden = false;
    doc.addEventListener('keydown', onKeydown);
    modal.keywords.focus();
  };
  const close = () => {
    modal.backdrop.hidden = true;
    doc.removeEventListener('keydown', onKeydown);
    returning = true;
    input.focus();
    returning = false;
  };

  // click as well as focus: close() hands focus back to the input, so clicking it again fires
  // no focus event.
  input.addEventListener('focus', open);
  input.addEventListener('click', open);
  input.addEventListener('input', open);
  modal.backdrop.addEventListener('click', (e) => {
    if (e.target === modal.backdrop) close();
  });
  return input;
}

/**
 * Keep Tab and Shift+Tab inside the dialog, wrapping at either end.
 * @param {Element} dialog
 * @param {KeyboardEvent} e
 */
function trapTab(dialog, e) {
  const items = [...dialog.querySelectorAll(FOCUSABLE)];
  const first = /** @type {HTMLElement} */ (items[0]);
  const last = /** @type {HTMLElement} */ (items[items.length - 1]);
  const active = dialog.ownerDocument.activeElement;
  if (e.shiftKey && (active === first || !dialog.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}
