// Rail feature entry (auto-discovered by build.mjs). The sidebar mounts on <body> once the
// message view's #tdf-chat exists; the theme tokens sit on <html>. See startRail in rail.js.
// The user list is read once the markup is parsed; the flag read first keeps a second copy
// (build.mjs's second-copy check) from touching the document.

import { whenDomReady } from '../../core/ready.js';
import * as shell from '../../core/shell.js';
import css from './rail.css';
import { startRail } from './rail.js';

if (!(/** @type {any} */ (window).__tdfChat2Rail)) whenDomReady(document, () => startRail({ doc: document, win: window, css, shell }));
