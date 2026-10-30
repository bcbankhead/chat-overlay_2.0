// Forum pages' site include entry (TDF-0028), a bundle of its own: the chat bundle's bootstrap
// expects the chat page. The guard is first, and its `__tdfChat2` prefix is what build.mjs's
// second-copy check lets through. The style goes in at once, so the rules exist before first
// paint when the tag sits in <head>; the moves wait for the parsed document (ready.js).

import { whenDomReady } from '../core/ready.js';
import css from './forum.css';
import { injectStyle, installForumNavbar } from './navbar.js';

if (!(/** @type {any} */ (window).__tdfChat2ForumLoaded)) {
  /** @type {any} */ (window).__tdfChat2ForumLoaded = true;
  injectStyle(document, css);
  whenDomReady(document, () => installForumNavbar(document));
}
