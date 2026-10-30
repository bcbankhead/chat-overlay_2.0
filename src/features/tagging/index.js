// Image reactions entry (auto-discovered by build.mjs). The wiring is start.js's; this file
// holds the double-load guard and the chat-page check.

import { MAIN_DIV } from '../../core/parse.js';
import { whenDomReady } from '../../core/ready.js';
import { expectReady } from '../../core/reveal.js';
import { startTagging } from './start.js';
import css from './tagging.css';

const win = /** @type {any} */ (window);
// Only the first copy of the script subscribes and attaches (the __tdfChat2 prefix is the one
// build.mjs's second-copy check sets).
if (!win.__tdfChat2Tagging) {
  win.__tdfChat2Tagging = true;
  const done = expectReady('tagging');
  // Ready once its store has rebuilt and its UI is installed, or the start has failed (a
  // failure startTagging reports itself, so it is not rethrown here).
  whenDomReady(document, () => {
    try {
      if (document.getElementById(MAIN_DIV)) startTagging({ win: window, doc: document, css }).then(done, done);
      else done();
    } catch (err) {
      done();
      throw err;
    }
  });
}
