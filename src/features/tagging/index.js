// Image reactions entry (auto-discovered by build.mjs). The wiring is start.js's; this file
// holds the double-load guard and the chat-page check. The picker is TDF-0009.10's
// openSmileyPicker (TDF-0009 Shared Contract).

import { MAIN_DIV } from '../../core/parse.js';
import { openSmileyPicker } from '../composer/index.js';
import { startTagging } from './start.js';
import css from './tagging.css';

const win = /** @type {any} */ (window);
// Only the first copy of the script subscribes and attaches (the __tdfChat2 prefix is the one
// build.mjs's second-copy check sets).
if (!win.__tdfChat2Tagging) {
  win.__tdfChat2Tagging = true;
  if (document.getElementById(MAIN_DIV)) startTagging({ win: window, doc: document, css, openSmileyPicker });
}
