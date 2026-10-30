// Pure port of createMessageDiv's text transform (message.js.php:871-966, :1082-1083),
// shared by live rendering and history replay. The output is untrusted HTML: it must
// pass through sanitize.js before insertion.

import { safeDecodeURIComponent } from './parse.js';

/**
 * @typedef {object} ExpandOptions
 * @property {(text: string) => string} [smilie] smilie expansion; at runtime `window.addSmilie`
 * @property {boolean} [enableEmail] engine setting `enableEmail` (default on)
 * @property {boolean} [enableUrl] engine setting `enableUrl` (default on)
 */

/** @param {string} text */
const identity = (text) => text;

/**
 * Expand a message's text field into HTML, as the engine does.
 * @param {string} text the decoded text field (body field [4])
 * @param {ExpandOptions} [options]
 * @returns {string}
 */
export function expand(text, options = {}) {
  const smilie = options.smilie ?? identity;
  const enableEmail = options.enableEmail ?? true;
  const enableUrl = options.enableUrl ?? true;

  let html = text
    .replace(/\[b\]/gi, '<b>')
    .replace(/\[\/b\]/gi, '</b>')
    .replace(/\[i\]/gi, '<i>')
    .replace(/\[\/i\]/gi, '</i>')
    .replace(/\[u\]/gi, '<u>')
    .replace(/\[\/u\]/gi, '</u>')
    .replace(/\[\[/gi, '<')
    .replace(/\]\]/gi, '>');

  html = smilie(html);

  if (enableEmail) {
    html = html.replace(/([\w.-]+@[\w.-]+\.[\w]+)/gi, "<a href='mailto:$1'>$1</a>");
  }

  // The engine embeds youtu.be links as an iframe; this view renders a plain link instead,
  // which the message view previews as a thumbnail (preview.js), never an iframe.
  let youTube = false;
  if (/http:\/\/youtu\.be\//i.test(html)) {
    const videoId = html.replace(/<\/?[biu]>/gi, '').split('/')[3] ?? '';
    const url = `https://youtu.be/${videoId}`;
    html = `<a href='${url}' target='_blank'>${url}</a>`;
    youTube = true;
  }

  if (enableUrl && !youTube) {
    html = html.replace(/(http[s]?:\/\/[\S]+)/gi, "<a href='$1' target='_blank'>$1</a>");
  }

  html = html.replace(/&#127;/gi, '|');
  return safeDecodeURIComponent(html);
}
