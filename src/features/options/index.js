// Settings feature entry (auto-discovered by build.mjs). The wiring is start.js's; this file
// holds the double-load guard and the chat-page check.

import { MAIN_DIV } from '../../core/parse.js';
import { whenDomReady } from '../../core/ready.js';
import { expectReady } from '../../core/reveal.js';
import css from './options.css';
import { startSettings } from './start.js';

const win = /** @type {any} */ (window);
if (!win.__tdfChat2Options) {
  win.__tdfChat2Options = true;
  const done = expectReady('options');
  whenDomReady(document, () => {
    try {
      if (document.getElementById(MAIN_DIV)) startSettings({ win: window, doc: document, css });
    } finally {
      done();
    }
  });
}
