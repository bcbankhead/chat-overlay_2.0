# UI mockup (reference, not product code)

The working mockup behind `docs/design/2026-10-27-ui-design.md`. It runs the built overlay
on a saved copy of the live chat, offline, and layers the design on top as plain scripts.
Units build the real thing in `src/`; this is what they look at to see the intended
behaviour. Nothing here is imported by the build.

## Files

- `serve.mjs` — local server for the harness (`http://localhost:5173/`). Serves
  `/tdf-chat.user.js` fresh from a worktree's `dist/`, and an optional folder of images as
  the gallery's placeholders (`/gallery/`, `/gallery/index.json`).
- `make-harness.mjs` — builds `harness.html` from a saved chat page: strips an installed
  copy of the overlay, loads `offline.js` first, fixes the saved `settings.js.php`.
- `offline.js` — stubs `XMLHttpRequest` so nothing reaches the chat server; seeds history;
  injects the overlay after the engine's `window.onload`, then the mockup scripts.
- `mockup/` — the design, one file per area (sidebar, messages, gallery, profile, settings,
  composer attach, whisper, smilies, reactions, colour shift `ink.js`, scrollbars, storage
  limits). `seed-history.js` adds a made-up third user ("Saia") for colour variety.
- `notes/toolbar-menus.md` — what each engine toolbar menu contains, captured live.

## Running it

The saved chat page is not committed (it holds other users' names and avatars), and the
engine's images come from the live site, so a run needs a capture of your own:

1. Copy this folder to `local/` at the repo root (gitignored via `.git/info/exclude`).
2. On the live chat, disable the userscript, reload, and save the page with Ctrl+S,
   "Webpage, complete", into `local/capture/` (`TDF Chat.html` + `TDF Chat_files/`).
3. The stylesheet's images (`templates/default/images/`, `smilies/`, `avatars/`,
   `images/`) are not in a browser save; fetch them from a live session into `local/`
   at those paths. Plain downloads are refused (403).
4. `node local/make-harness.mjs <a worktree with node_modules>`
5. `npm run build` in the worktree to test, then
   `node local/serve.mjs <worktree> 5173 [folder of placeholder images]`.

`?mock=0` shows the overlay without the mockup.
