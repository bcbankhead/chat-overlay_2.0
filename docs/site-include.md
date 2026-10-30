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

- `dist/tdf-chat.js`: the site include. `npm run deploy` uploads this one.
- `dist/tdf-chat.user.js`: the userscript, for members who install it with Tampermonkey.

The build exits with an error (do not upload its output) if either file would use a userscript-manager API
(`GM_*`, `GM.*`, `unsafeWindow`), or if a second copy on the same page would do anything.

## Install

1. Sign in to AWS, then deploy:

   ```sh
   aws sso login --profile conduit
   npm run deploy
   ```

   `npm run deploy` runs the tests and the build, then uploads `dist/tdf-chat.js` to
   `s3://sb76images/tdf_chat_2.0/tdf-chat.js` with `Content-Type: text/javascript` and
   `Cache-Control: max-age=300`. If the tests or the build fail, nothing is uploaded and the
   command exits with an error. The script uses the AWS profile `conduit`; no credentials are
   stored in the repository.
2. In the chat's `index.php`, add a script tag. It works anywhere on the page; inside
   `<head>` is recommended:

   ```html
   <head>
     …
     <script src="https://sb76images.s3.us-west-2.amazonaws.com/tdf_chat_2.0/tdf-chat.js"></script>
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
