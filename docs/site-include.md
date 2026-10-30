# TDF Chat 2.0 — site include

For the site admin. This loads TDF Chat 2.0 for every member, with no browser extension
needed. It is the same script as the userscript, built from the same source by the same
command.

## Build

```sh
npm ci
npm run build
```

This writes two files:

- `dist/tdf-chat.js`: the site include. Upload this one.
- `dist/tdf-chat.user.js`: the userscript, for members who install it with Tampermonkey.

The build exits with an error (do not upload its output) if either file would use a userscript-manager API
(`GM_*`, `GM.*`, `unsafeWindow`), or if a second copy on the same page would do anything.

## Install

1. Upload `dist/tdf-chat.js` to the site, for example to `/forum/chat/js/tdf-chat.js`.
2. In the chat's `index.php`, add a script tag **after the chat engine's own script tags**,
   just before `</body>`:

   ```html
   <script src="/forum/chat/js/tdf-chat.js?v=0.1.2"></script>
   </body>
   ```

   The script needs the chat container and the engine's globals (`roomID`,
   `handleMessages`, `receiveMesReq`, …) to exist when it runs. If the engine is not there
   yet, members see a small "TDF Chat 2.0 did not start" notice and keep the original chat.

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
