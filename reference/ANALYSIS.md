# TDF Chat — engine analysis (2026-10-26)

Source snapshot: `reference/site-js/` (fetched unauthenticated; `settings.js.php` may differ per user).

## Engine
- Pro Chat Rooms **v8.4.2** (not a phpBB extension). jQuery 1.9.1, jQuery UI.
- Integrated with phpBB for identity (`profileUrl` → `memberlist.php?mode=viewprofile&u=`).
- Globals in page scope: `uID`, `userName`, `roomID`, `lastMessageID`, `refreshRate` (3000 ms), `totalMessages` (50).

## Transport
- **Poll:** `GET includes/getData.php?roomID=&history=&last=<lastMessageID>&s=&rnd=` every 3 s (`setInterval('getMessages()')`, `mTimer`).
  XML: `<root><usermessage/>…<userlist/>…<userrooms/>`.
- **usermessage** = `}{`-delimited: `[0]id [1]uid [2]targetDiv [3]user [4]toUser [5]body [6]? [7]sfx [8]unixTime`.
- **body** (URI-encoded) = `|`-delimited: `avatar|color|size|family|text|ircFlag|lineBreakFlag`. Literal `|` in text is sent as `&#127;`.
- **Send:** `POST includes/sendData.php` form-encoded: `uid, umid, uroom, uname, toname, umessage, usfx`.
- **History:** server returned only 1 message on `history=1` (dated 2023-06). Server history is effectively absent — local DB is the only history.

## Rendering (`createMessageDiv`)
- `[b] [i] [u]` → tags; **`[[` / `]]` → `<` / `>`** — raw HTML passes through. Clickable-link-with-text (spec 5b) is achievable as `[[a href='…' target='_blank']]text[[/a]]`.
- URLs auto-linked; emails auto-linked; `http://youtu.be/` → iframe.
- `lineBreakFlag=1` → wrapped in `<pre style='white-space:pre-wrap'>`. **Newlines are supported** (spec 5a feasible).
- Two layouts: classic and "modern" bubbles (`#userMessStyle` checkbox). Message div id = server unix time.

## Client-side limits
- `floodChat = 0` (client flood gate disabled). Server-side flood/spam threshold **unknown** — needs empirical test.
- Identical consecutive message rejected client-side (`lastMessageTxt`). Max 2048 chars.
- Idle timeout 900 s, idle logout 3600 s.

## Images
- No inline image upload in the composer. **Share Files** plugin: `plugins/share/index.php`, multipart POST `shareID` (public/private radio), `shareWithUser`, `uploadedfile`. Live form (observed 2026-10-28): `action="index.php"`, `shareID` radios valued `1` (Public) and `2` (Private), each named only by bare text in its own table cell (no `<label>`), and a named submit `submit=Upload File`.
- **Observed share message** (public, 2026-10-26). Body has only 5 `|` fields (no irc/lineBreak flags); text field:
  `[[br]][[a href="plugins/share/view.php?id=<digits>" target="_blank"]][[img src="plugins/share/view.php?id=<same>" style="max-width:250px; max-height:250px;" border="0"]][[/a]]`
  Quotes are `"`. Detect images by `plugins/share/view.php?id=` in the text field. Ids are usually 15 digits, not always: `17933387086952` (14) was seen live on 2026-10-30.
- `GET plugins/share/view.php?id=…` (same-origin, session cookie) → `200 image/jpeg`, raw bytes (1.7 MB sample, full resolution), no `Content-Disposition`, `no-store`. Bytes can be fetched into IndexedDB as a Blob. Content-type must be read from the response (do not assume JPEG).
- Server returns no history, so an image is only capturable while the script is running and polling.

## Decisions
- **Image storage (2026-10-26):** default stores the `view.php?id=` URL plus metadata only. Full image Blobs are stored only when the user opts in to "Store images offline". URL-only mode also stores a locally generated canvas thumbnail (~10–20 KB) per image, because `view.php` is `no-store` and has no thumbnail variant. Server-side retention of shared files is unknown: a URL-only entry whose fetch fails shows its thumbnail with a broken-link state.

## User functions (`userlist.js.php` `userPanel`)
- whisper (`whisperUser` → `#whisperID`), block (`blockUsers`), profile (`viewProfile`), private chat (`createPChatDiv`), status (`sendStatus`: Here/BRB/Away), rooms (`changeRooms`).

## Smilies (candidate "like" set)
`:)` `;)` `:P` `:7` `;(` `:(` `:V` `[(` `[x` `:h`(heart) `*R` `8)` `:d` `:L`(loveit) `:o`
