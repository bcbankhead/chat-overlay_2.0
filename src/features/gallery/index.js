// Gallery feature entry (auto-discovered by build.mjs). The wiring is start.js's; this file
// holds the double-load guard and the chat-page check.

import { MAIN_DIV } from '../../core/parse.js';
import { whenDomReady } from '../../core/ready.js';
import css from './gallery.css';
import { startGallery } from './start.js';

const win = /** @type {any} */ (window);
// Only the first copy of the script captures and registers (the __tdfChat2 prefix is the one
// build.mjs's second-copy check sets).
if (!win.__tdfChat2Gallery) {
  win.__tdfChat2Gallery = true;
  whenDomReady(document, () => {
    if (document.getElementById(MAIN_DIV)) startGallery({ win: window, doc: document, css });
  });
}
