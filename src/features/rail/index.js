// Rail feature entry (auto-discovered by build.mjs). The rail mounts inside the message
// view's #tdf-chat, so it inherits its theme tokens; see startRail in rail.js.

import css from './rail.css';
import { startRail } from './rail.js';

startRail({ doc: document, win: window, css });
