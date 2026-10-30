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

This writes two files:

- `dist/tdf-chat.js`: the site include. Upload this one.
- `dist/tdf-chat.user.js`: the userscript, for members who install it with Tampermonkey.

The build exits with an error (do not upload its output) if either file would use a userscript-manager API
(`GM_*`, `GM.*`, `unsafeWindow`), or if a second copy on the same page would do anything.

## Install

1. Upload `dist/tdf-chat.js` to the site, for example to `/forum/chat/js/tdf-chat.js`.
2. In the chat's `index.php`, add a script tag. It works anywhere on the page; inside
   `<head>` is recommended:

   ```html
   <head>
     …
     <script src="/forum/chat/js/tdf-chat.js?v=0.1.2"></script>
   </head>
   ```

   Placed in `<head>`, the script hides the page (showing only its background colour) until
   the overlay has mounted, so members never see the original chat flash first on a slow
   load. If the overlay has not mounted after 5 seconds the page is shown anyway.

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

Build again, replace the uploaded `tdf-chat.js`, and change the `?v=` query string in the
script tag to the new version from `package.json`. Without that change, browsers can keep the
old cached copy.
