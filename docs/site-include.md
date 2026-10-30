# TDF Chat 2.0 — site include

For the site admin. This loads TDF Chat 2.0 for every member, with no browser extension
needed. It is the same script as the userscript, built from the same source by the same
command.

## Build

The userscript's `@match` comes from `build.local.json`, which is not committed. Before the first
build, copy `build.local.example.json` to `build.local.json` and set `"match"` to the chat's URL
pattern. The build fails, naming the example file, while `build.local.json` is missing, and also when
`"match"` is empty or spans more than one line.

```sh
npm ci
cp build.local.example.json build.local.json   # then set "match"
npm run build
```

This writes three files:

- `dist/tdf-chat.js`: the site include. `npm run deploy` uploads this one.
- `dist/tdf-chat.user.js`: the userscript, for members who install it with Tampermonkey.
- `dist/tdf-forum-sticky-header.js`: the forum pages' include (see
  [Forum sticky header](#forum-sticky-header)). `npm run deploy` uploads this one too.

The build exits with an error (do not upload its output) if any file would use a userscript-manager API
(`GM_*`, `GM.*`, `unsafeWindow`), or if a second copy on the same page would do anything.

## Install

1. Sign in to AWS, then deploy:

   ```sh
   aws sso login --profile conduit
   npm run deploy
   ```

   `npm run deploy` runs the tests and the build, then uploads `dist/tdf-forum-sticky-header.js`
   and then `dist/tdf-chat.js` to `s3://sb76images/tdf_chat_2.0/` with
   `Content-Type: text/javascript` and `Cache-Control: max-age=300`. `tdf-chat.js` goes last
   because its first line is the live version marker: if an upload fails, the live version is
   unchanged and the deploy can simply be re-run. If the tests or the build fail, nothing is
   uploaded and the command exits with an error. The script uses the AWS profile `conduit`; no credentials are
   stored in the repository.
2. In the chat's `index.php`, add a script tag. It works anywhere on the page; inside
   `<head>` is recommended:

   ```html
   <head>
     …
     <script src="https://sb76images.s3.us-west-2.amazonaws.com/tdf_chat_2.0/tdf-chat.js"></script>
   </head>
   ```

   Placed in `<head>`, the script keeps the page transparent (showing only its background
   colour, and taking no clicks or keystrokes) until the page has finished loading and been laid out by the
   chat engine, and the overlay and every feature — the sidebar, the composer, the gallery,
   reactions and settings — have finished starting. It then fades the page in, so members
   never see the original chat, or a half-styled overlay, on a slow load. If that has not
   happened after 8 seconds the page is shown anyway, and the browser console names what was
   still starting. A tag at the end of the body does not hide the page at all.

   Wherever the tag sits, the script waits until the page has been parsed, then needs the
   chat container and the engine's globals (`roomID`, `handleMessages`, `receiveMesReq`, …).
   If the engine is not there, members see a small "TDF Chat 2.0 did not start" notice and
   keep the original chat. A tag placed just before `</body>`, after the engine's own script
   tags, also works; it simply cannot prevent the flash.

## Several chat tabs

Members can keep the chat open in several tabs; each tab shows the overlay and saves
history. The one exception follows an update: a tab still running an older copy of the
script can hold the database open on the old version. The new tab then shows the original
chat with a notice, "TDF Chat 2.0 is waiting for another TDF Chat tab to close", and the
overlay appears by itself as soon as that old tab is closed or reloaded.

## What it stores

Nothing on the server. Every member's history, settings and theme are kept in that
member's own browser (IndexedDB, database `tdf-chat-2`). The server serves only the static
file. Clearing site data in the browser clears that member's history.

## Members who also run the userscript

They are not affected. Whichever copy runs first sets `window.__tdfChat2Loaded`, and the
other copy does nothing, so the interface is created only once. The userscript runs with
`@grant none` so that both copies share the same `window` and see the same flag. The build
checks this.

## Updating

Bump `version` in `package.json`, then run `npm run deploy` (after `aws sso login --profile
conduit` if the session has expired). The file is served with `max-age=300`, so members pick
up the new build within about 5 minutes. Adding a `?v=<version>` query string to the script
tag is optional; it makes browsers fetch the new build immediately.

To check which version is live, read the bundle's first line, which names the
`package.json` version:

```sh
curl -s https://sb76images.s3.us-west-2.amazonaws.com/tdf_chat_2.0/tdf-chat.js | head -1
# // TDF Chat 2.0 v<version> — site include build …
```

`curl -I https://sb76images.s3.us-west-2.amazonaws.com/tdf_chat_2.0/tdf-chat.js` shows the
headers, including `Content-Type` and `Cache-Control`.

## Forum sticky header

A second site include, for the forum pages rather than the chat. It replaces the "TDF: Chatting
users in nav + sticky navbar" userscript:

- The Chat link and the "Chatting users" list (from the "Who is online" block) move into a row
  under the breadcrumbs.
- The navbar block moves out of the page header, so it stays pinned to the top of the window
  while the whole page scrolls.

Anything the page lacks (the Chat link, the online list, the header) is skipped; the rest still
happens.

### Build and deploy

`npm run build` writes it as `dist/tdf-forum-sticky-header.js`, beside the chat files, and checks it
the same way: the build fails, writing nothing, if it uses a userscript-manager API or a second copy
would do anything. `npm run deploy` uploads it to
`s3://sb76images/tdf_chat_2.0/tdf-forum-sticky-header.js`, with the same `Content-Type` and
`Cache-Control` as `tdf-chat.js`, before `tdf-chat.js`. Both files carry the same `package.json`
version, so the Updating steps above cover both.

### Install

In the forum's header template, add a script tag beside the forum's other header scripts:

```html
<script src="https://sb76images.s3.us-west-2.amazonaws.com/tdf_chat_2.0/tdf-forum-sticky-header.js"></script>
```

Inside `<head>`, its style is added at once, before the page first paints, and the moves wait until
the page has been parsed. Placed at the end of `<body>`, it does everything immediately; the navbar
may then be seen in its old place for a moment.

### Members who also run the userscript

They get one row. The include does nothing on a second load (`window.__tdfChat2ForumLoaded`), builds
no row when the userscript's `#tm-chat-row` is already there, and leaves a navbar that is already out
of the header where it is. If the userscript runs second, it finds nothing left to move. Members can
uninstall the userscript once the tag is live.

### Checking the live copy

```sh
curl -s https://sb76images.s3.us-west-2.amazonaws.com/tdf_chat_2.0/tdf-forum-sticky-header.js | head -1
# // TDF Forum sticky header v<version> — site include build …
curl -I https://sb76images.s3.us-west-2.amazonaws.com/tdf_chat_2.0/tdf-forum-sticky-header.js
```
