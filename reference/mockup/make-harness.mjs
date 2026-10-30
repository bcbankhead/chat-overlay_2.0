// Builds local/harness.html from the saved chat page (local/capture/TDF Chat.html):
// strips what the installed userscript had injected, loads offline.js before the engine
// so it never reaches the network, and leaves the overlay to be injected by offline.js
// after the engine's own window.onload, as a document-idle userscript would be.
// Usage: node local/make-harness.mjs <dir holding node_modules/happy-dom>

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(process.argv[2] ?? process.cwd(), 'package.json'));
const { Window } = require('happy-dom');

const src = readFileSync(path.join(here, 'capture', 'TDF Chat.html'), 'utf8');
const win = new Window({ settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
const doc = win.document;
doc.write(src);

for (const sel of ['#tdf-chat', '#tdf-chat-style', '#tdf-composer-style', '[id^="tdf-"]']) {
  doc.querySelectorAll(sel).forEach((n) => n.remove());
}
// The overlay hides the engine's own view; the captured page carries that state.
doc.querySelectorAll('[style*="visibility"]').forEach((n) => n.style.removeProperty('visibility'));

const offline = doc.createElement('script');
offline.setAttribute('src', 'offline.js');
doc.head.insertBefore(offline, doc.head.querySelector('script'));

// The saved settings.js.php carries `var groupChat = ;` and its siblings (the server
// left the user-group values empty for the save's request), a syntax error that drops
// every engine setting. Fill them with what the live page reported (groupPChat 1).
const settingsFile = path.join(here, 'capture', 'TDF Chat_files', 'settings.js.php');
const settings = readFileSync(settingsFile, 'utf8');
const GROUP = { groupChat: 1, groupPChat: 1, groupCams: 0, groupWatch: 0, groupRooms: 1, groupVideo: 0 };
const fixed = settings.replace(/var (group[A-Za-z]+) = ;/g, (_, k) => `var ${k} = '${GROUP[k] ?? 0}';`);
if (fixed !== settings) {
  writeFileSync(settingsFile, fixed);
  console.log('filled the empty group values in settings.js.php');
}

const html = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML.replaceAll('./TDF Chat_files/', 'capture/TDF Chat_files/');
writeFileSync(path.join(here, 'harness.html'), html);
console.log(`wrote local/harness.html (${html.length} bytes)`);
await win.happyDOM.close();
