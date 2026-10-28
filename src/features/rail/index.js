// Rail feature entry (auto-discovered by build.mjs). The sidebar mounts on <body> once the
// message view's #tdf-chat exists; the theme tokens sit on <html>. See startRail in rail.js.

import * as shell from '../../core/shell.js';
import css from './rail.css';
import { startRail } from './rail.js';

startRail({ doc: document, win: window, css, shell });
