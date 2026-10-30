# Toolbar menus — captured 2026-10-27

Engine: Pro Chat Rooms v8.4.2. Icon order in `#optionsIcons`, left to right.
Client-built menus come from `settings.js.php` via `createMenu()` (functions.js.php);
their full contents are in `menus.json`. Server-loaded ones were captured from a live
session.

| # | Icon | Title | Handler | Kind |
|---|------|-------|---------|------|
| 1 | smiley | Smilies | `doSmilies` | client menu, 15 smilies, 5 per row |
| 2 | bell | Ring Bell | `ringBell` | action: sends a bell, no menu |
| 3 | pen | Text Options | `doStyles` | three client menus: 108 colours (12/row), 11 fonts, 9 sizes |
| 4 | person | Avatars | `doAvatars` | upload iframe `avatars/upload.php`, then default avatars couple/female/male |
| 5 | speaker | Play SFX | `doSFX` | client menu, 20 sounds |
| 6 | eraser | Clear Screen | `clrScreen` | action: empties `#chatContainer`, no menu |
| 7 | wrench | User Options | `editSettings` | settings — not captured (out of scope for now) |
| 8 | quote | Message History | `showInfoBox("viewTranscripts", …, "index.php?transcripts=1&roomID="+roomID)` | server window |
| 9 | list | Chat Help | `newWin("help/index.php")` | separate page |
| 10 | tree | Share Files | `showInfoBox("shareFiles", …, "plugins/share/")` | server window |

## Message History (server window, `screens/message-history.jpg`)

Title bar "Message History" with an x. A table:

| Time | Room | Sender | Recipient | Message |
|------|------|--------|-----------|---------|

Rows are the room's messages (time `HH:MM:SS`, room id, sender, `Room` or a user,
message text truncated with `...`). Then a "Close Window" button.

## Share Files (server window, `screens/share-files.jpg`)

Title "Share Files" with an x.

- "Select who to share files with,"
  - ( ) Public - Share file with the Room? (default)
  - ( ) Private - Share file with another User?
- "Enter User:" text field
- "Select a file to share," file picker
- "Upload File" button
- "Close Window" button

## Chat Help (`help/index.php`, "Pro Chat Rooms - User Help v8.4.2")

Sections: Send Message, Smilies/Emoticons, Avatars, Share Files*, Sound Effects (SFX),
Ring Bell, Games*, Text Styles (icon "A | B"), Transcripts, Disconnect, Clear Screen,
Options, Auto Scroll, Private Chat, Create a Room*, Users/Room List, Default Symbols,
IRC Type Commands, YouTube Player. (* = plugin, may be unavailable.)

Notable behaviour it documents:

- **Options**: Private Chat, Allow Webcam Access, Play Entry/Exit Sounds, Play New
  Message Sounds, Play SFX.
- **Private Chat**: by name in the Whisper box, or click a user and choose "Private Chat"
  (opens a private chat window).
- **Default Symbols**: (A) Administrator, (M) Moderator, (S) Approved Speaker.
- **IRC Type Commands**: `/roll ndn [+mod]` (dice, e.g. `/roll 3d3 +10`),
  `/me message` (action message), `/broadcast message` (admins only).
- **YouTube Player**: pasting a YouTube URL and sending plays it in the room.

## Assets

The images the stylesheet and menus use were captured from the live session into
`local/templates/default/images/`, `local/images/`, `local/smilies/`, `local/avatars/`
(39 files, 161 KB): toolbar icon sprites, Send/Logout, logo, background, the 15 smilies
and 3 default avatars.
