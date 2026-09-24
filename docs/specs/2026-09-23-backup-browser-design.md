# Weyland-BackupBrowser: browse and restore chat backups

**Date:** 2026-09-23

## Goal

SillyTavern writes an automatic backup of a chat every time it saves one. Nothing in this
deployment's SillyTavern (1.13.3, managed by the Weyland devs) lets a user see or use those backups.
Upstream SillyTavern added a native backups browser in a later release, but this fork can't be
updated from here.

Add a **Backups** button to the welcome screen, next to **Temporary Chat**. It opens a window
where the user picks a character, sees that character's backups grouped by original chat, previews
any snapshot, and restores it as a new chat in that character's chat list.

## Non-goals and constraints

- **Client-side extension only.** No changes to SillyTavern core, no server plugin, no other
  extension touched. The design uses only endpoints that exist in 1.13.3.
- **Chat backups only.** Settings backups (`settings_<handle>_*.json`, same folder) are out of
  scope for now.
- **Character chats only.** Backups that can't be tied to exactly one current character are
  hidden. That covers group chats, deleted or renamed characters, and key collisions (see below).
- **Restore never overwrites.** A restored backup always becomes a new chat file. Existing chats
  are never modified or deleted.
- **The extension deletes nothing.** No backup, chat, or other file is ever removed by it.
- **No settings.** There is nothing to configure, so there is no `extension_settings` entry and no
  settings panel.
- **Backups are a rolling window, not an archive.** The extension shows what SillyTavern still
  has. It can't recover backups SillyTavern has already pruned, and it doesn't try to keep backups
  from being pruned.

## Evidence this design is based on

Measured on this deployment's live server (`default-user`, 2026-09-23) and in the 1.13.3 source.

- **The backup folder.** `data/default-user/backups/` holds 867 chat backups for 23 characters,
  plus 50 settings backups. All 867 map to exactly one current character with the key rule below.
  There are no collisions, no orphans, and no group-chat backups.
- **Data Maid can list and read backups.**
  - `POST /api/data-maid/report` took 0.18 s and returned all 867 backups as
    `{name, hash, size, mtime}`.
  - `GET /api/data-maid/view` returned the largest backup (3.3 MB, Cerberus Sisters) byte-identical
    to the file on disk in 0.02 s.
  - `POST /api/data-maid/finalize` returned 204.
- **The native import restores it exactly.** `POST /api/chats/import` wrote that backup into
  Cerberus Sisters' chat folder as `Cerberus Sisters - 2026-9-23 @16h 15m 57s 608ms imported.jsonl`,
  byte-identical to the backup. It did not create a new backup: the character still had 50
  afterwards. The test file was then deleted, and the folder was back to its original state
  (empty).
- **Backups can be grouped by chat.**
  - Cerberus Sisters currently has **no** chats, but all 50 of its backups carry the same
    `chat_metadata.integrity` UUID and `create_date` (2026-09-11@19h59m15s). They are 50
    snapshots of one deleted chat, taken 2026-09-16 to 2026-09-21.
  - Kai's 44 backups likewise share one integrity UUID.
- **Backups are large.** They average about 0.8–1 MB. Most of that is the header line, whose
  `chat_metadata.variables` carries Weyland QR state (about 500 KB in the Cerberus file).

## Background: how SillyTavern 1.13.3 writes chat backups

- **When they're written.** `src/endpoints/chats.js` backs up on every `/api/chats/save` and
  `/api/chats/group/save`.
- **Throttling.** The backup call is throttled per user handle: lodash `throttle`, 10 s,
  leading and trailing.
- **File names.** A backup is named `chat_<key>_<YYYYMMDD-HHMMSS>.jsonl`, and the timestamp is in
  the server's local time.
  - For a character chat, `<key>` = `sanitize(String(avatar).replace('.png', ''))`, with
    `/[^a-z0-9]/gi` replaced by `_`, then lowercased. `sanitize` is `sanitize-filename` 1.6.3.
  - For a group chat, `<key>` is derived from the group chat's id.
- **Retention.** After each write, `removeOldBackups(dir, 'chat_<key>_')` keeps the newest 50 by
  mtime (`backups.common.numberOfBackups`).
  - **Those 50 are shared by every chat of that character.** On a busy character they cover a
    short window: Bap's 50 cover about two hours of one day.
  - The prune matches by prefix, so a key that's a prefix of another key followed by `_` shares
    that count. For example, `bap` would also count `bap_2`'s files. That's a core quirk, and
    nothing here depends on it.
- **Contents.** A backup is a full copy of the chat file at that save. The first line is the
  header: `user_name`, `character_name`, `create_date`, and `chat_metadata` (including
  `integrity`, a UUID that stays stable for the life of a chat). Each following line is one
  message.
- **No way to read them.** There is no backups endpoint and no static route to the backups folder
  in 1.13.3.

### Data Maid (the read path)

Data Maid is SillyTavern's stock cleanup tool (User Settings → Miscellaneous → **Clean-Up**). Its
server router, `src/endpoints/data-maid.js`, is mounted at `/api/data-maid`.

- **`POST /report`** scans the user's data folder.
  - It returns `{report, token}`. `report.chatBackups` lists every `chat_*` file in the backups
    folder as `{name, hash, size, mtime}`.
  - `hash` is `sha256(absolute path)`, so the same file gets the same hash in every report.
  - The server remembers the token together with the paths it covers. Each report **replaces**
    the user's previous token: there is one token per user.
- **`GET /view?hash&token`** returns the raw bytes of one file in that token's path list, and
  refuses anything outside the user's folder.
- **`POST /finalize {token}`** discards the token.
- **`POST /delete`** deletes files by token and hash. **This extension never calls it.**

Every endpoint uses `req.user.directories`, so each account only sees its own backups.

## Architecture

The extension lives at `data/default-user/extensions/Weyland-BackupBrowser/` and is its own git
repository (`aerosplat-dev/Weyland-BackupBrowser`). It has no build step and no dependencies, and
it is tested with `node --test`.

| Unit | Responsibility |
|---|---|
| `lib/backupNames.js` | **Pure.** `parseBackupFileName(name)` returns `{key, stamp}` or `null`, anchored on the trailing `_<8 digits>-<6 digits>.jsonl`, so keys may contain `_`. `characterBackupKey(avatar)` ports the server's key rule, including `sanitize-filename`'s rules and 255-byte UTF-8 truncation. `matchBackupsToCharacters(backups, characters)` returns one map entry per character that has backups. A key matching zero characters, or more than one, is dropped. |
| `lib/dataMaidClient.js` | **The only module that talks to Data Maid.** `openSession()` calls report and keeps only `chatBackups` and the token. `fetchBackupText(session, hash, signal)` calls view. On a 403 it re-reports once, updates the session token, and retries the same hash. A 404 becomes a typed "gone" result. `closeSession(session)` calls finalize. There is no delete function. |
| `lib/chatSummary.js` | **Pure.** `summarizeBackup(text)` returns `{userName, characterName, createDate, chatId, messageCount, lastMessage: {name, excerpt, sendDate}}`. `chatId` is `chat_metadata.integrity`, falling back to `create_date` when there is no integrity. The excerpt is the last ~300 characters. The full text is never kept. A missing or unparseable header returns `null` ("unreadable"). |
| `lib/grouping.js` | **Pure.** `groupSnapshots(snapshots, existingChats, restored)` groups summarized snapshots by `chatId`. Groups are ordered newest-latest-snapshot first, and snapshots within a group newest first. Each group gets a status: `restored` (a restore this session, with its file name), else `exists` (a current chat with that `chatId`, with its file name), else `deleted`. |
| `lib/existingChats.js` | `listCurrentChats(avatar)` calls `/api/characters/chats {avatar_url, simple: true}` (the response `{error: true}` means none), then `/api/chats/get` for each file to read its header's `chatId`. It returns `[{fileName, chatId}]`. It never calls `/api/chats/get` unless the listing returned files. |
| `lib/restore.js` | `createRestoreQueue()` runs restores one at a time. `restoreSnapshot(...)` downloads the backup text, ensures the chats folder exists, and posts it to `/api/chats/import`. It identifies the new file by diffing the chat list before and after the import. |
| `lib/ui/welcomeButton.js` | Injects the **Backups** button into the welcome panel and re-injects it when the panel is rebuilt. |
| `lib/ui/browserPopup.js` | Builds and runs the popup: the character list, grouped chats, progress, preview, and the Restore and Open buttons. |
| `index.js` | Wires everything together at load. |
| `style.css` | Popup layout only, using SillyTavern theme variables. Every class and id is prefixed `wbb-`. |

`manifest.json`:

- `display_name: "Weyland-BackupBrowser"`, `author: "weyland-tavern"`, `version: "1.0.0"`
- `loading_order: 500` (no pipeline role; it only adds UI)
- `auto_update: false`, `minimum_client_version: "1.13.3"`
- `homePage`: the aerosplat-dev repo

Log lines and toasts are prefixed `[Weyland-BackupBrowser]`. UI strings go through SillyTavern's
`t` so they can be translated.

### Data flow

1. **The popup opens.** The extension opens one Data Maid session and builds the character map
   from `SillyTavern.getContext().characters`, computed now rather than at startup, when
   characters may not be loaded yet.
2. **The character list renders.** It is built from file names, sizes and mtimes alone, so
   nothing is downloaded yet.
3. **A character is selected.**
   - The extension lists that character's current chats and their chat IDs. At the same time it
     downloads the character's backups newest-first, 4 at a time.
   - Each summary is cached in a module-level `Map` keyed by `hash:size:mtime`, so it lasts for the
     page session and reopening the popup is instant for anything already read. Only summaries are
     cached, never file text.
   - Groups re-render as summaries arrive.
4. **Switching character or closing the popup** aborts that character's in-flight downloads
   through an `AbortController`.
5. **Closing the popup** calls finalize in a `finally`, so it runs even on error.

Times shown in the UI come from `mtime`, not the file-name stamp. `mtime` is an absolute instant,
which the server-local stamp isn't, and it's the same field SillyTavern prunes by.

## UI and interaction

### Button

A `menu_button menu_button_icon` with `fa-solid fa-box-open` and the label **Backups**, placed
immediately after `button.openTemporaryChat` inside `.welcomePanel .welcomeShortcuts`.

Core rebuilds the panel on every `openWelcomeScreen()`: on load, on `CHAT_CHANGED` with no chat
open, and after renaming or deleting a recent chat. Core appends the panel as a direct child of
`#chat`. So a `MutationObserver` on `#chat` (`childList`) adds the button whenever a panel without
one appears. That's idempotent: the button carries a marker class, and the extension checks for it
before adding.

### Popup

A native `Popup` (`POPUP_TYPE.TEXT`, `large: true`, `wide: true`, OK button labelled **Close**).
There's no custom positioning, portal or `position: fixed`.

- **Notice line (top):** "SillyTavern keeps only the latest 50 saves per character. Chatting with a
  character pushes its oldest backups out, so restore what you need first."
- **Left pane, characters:** only characters with at least one matched backup, sorted by newest
  backup. Each row shows the avatar thumbnail (`getThumbnailUrl('avatar', avatar)`), name, number
  of backups, and the newest backup's time.
- **Right pane, the selected character's chats, grouped by chat:**
  - **Group header:** "Chat started <create_date>", the persona name, and a status tag:
    **Deleted**, **Exists: <file>**, or **Restored: <file>**.
  - **Latest snapshot:** time, message count, size, the last-message excerpt, and **Preview** and
    **Restore** buttons.
  - **"N older snapshots" toggle:** expands to one compact row per older snapshot (time, message
    count, Preview, Restore).
  - **While downloading:** a progress line, "Reading backups 12 / 50". Snapshots not yet read
    show as pending.
  - **Unreadable snapshots** are listed under their own "Unreadable" group with Preview and
    Restore disabled.
- **Narrow screens:** below SillyTavern's mobile breakpoint (`max-width: 1000px`) the panes stack.
  The character list is one view, and choosing a character switches to its chats with a back
  control. This is done with a view attribute on the popup root plus CSS for each view value.
  **Every CSS rule keyed on that attribute must list each view value it applies to.**

### Preview

A second native popup (`POPUP_TYPE.TEXT`, large, wide, vertical scrolling) showing every message
in order: speaker, send date, then the message text.

- Message text is inserted **only as `textContent`**. Nothing from a backup is ever parsed as HTML.
- The popup opens scrolled to the bottom.
- The text is downloaded again for each preview and is not cached.

### Restore

Clicking **Restore** enqueues the snapshot, and the row shows "Queued…", then "Restoring…". Each
job runs these steps:

1. Download the text through `fetchBackupText`.
2. **Snapshot the character's chat list** (`/api/characters/chats`, `simple`).
3. **Make sure the character's chats folder exists.** Call `/api/chats/get {avatar_url}` with no
   `file_name`. Core creates the folder if it's missing and returns `{}`. Without this, import
   fails when the folder doesn't exist.
4. **Import.** `POST /api/chats/import` as `multipart/form-data`, with headers from
   `getRequestHeaders({omitContentType: true})` and these fields:
   - `avatar`: the backup as a `File` (Blob) named after the backup
   - `file_type`: `jsonl`
   - `avatar_url`: the character's avatar
   - `character_name`: the character's current name, which only affects the new file's name
   - `user_name`: the header's `user_name`
5. **Check the result.** Success is `{res: true}`. Anything else counts as a failure.
6. **Find the new file.** List the chats again and diff against the snapshot. Exactly one new file
   is the restored chat. Zero or several new files still count as a success, but no file name is
   known.

**Result:**

- **One new file found:** the row shows **Restored as <file>** with an **Open** button, and the
  group's status becomes **Restored: <file>**.
- **No file name known:** it shows "Restored, find it in <Char>'s chat list", with no Open button.

Import writes `<character_name> - <humanized timestamp with ms> imported.jsonl`, and it copies the
uploaded bytes unless its Chub-format flattening changes something. Flattening re-serializes every
line and is a no-op for SillyTavern-written chats; the live test confirmed a byte-identical
result.

**Restored chats keep their original metadata (decided).** The file is restored byte for byte, so
Weyland chat variables and the Weyland-LTM memory-book binding (`chat_metadata.world_info`) come
back with it. For a deleted chat, that's the goal. For a snapshot of a chat that still exists, both
copies bind to the same memory book. That book may already hold memories from after the snapshot,
and both chats will keep adding to it. On a group tagged **Exists**, clicking Restore first shows
this as an inline note on the row with a confirm-in-place second click. There's no separate popup.

**Queue discipline.**

- The queue's in-progress tracking is added as the **first statement inside `try`** and removed in
  `finally`, so a failed restore can never leave a snapshot stuck as "restoring".
- Restores keep running if the popup closes; each result is then reported by a toast.
- **Open** buttons are disabled while the queue has pending jobs. Opening a chat can trigger saves
  that prune that character's not-yet-downloaded backups.

### Open

**Open** closes the popup, then opens the restored chat:

1. **If the character's current chat pointer (`characters[id].chat`) names a file that isn't in its
   current chat list:** set `characters[id].chat` to the restored file name first. That's the same
   assignment core's `openCharacterChat` makes as its first step.
   - Without this, `selectCharacterById` would load the missing chat and core would recreate it as
     a greeting-only file, and that save would prune one more of the character's backups.
   - **This is the extension's only write to core in-memory state.**
2. **Follow core's recent-chat opener exactly** (`openRecentCharacterChat` in
   `welcome-screen.js`): `selectCharacterById(id)`, `setActiveCharacter(avatar)`,
   `saveSettingsDebounced()`, then `openCharacterChat(fileName)` (without `.jsonl`).
   `openCharacterChat` saves the pointer to the card the normal way.

Closing the popup after at least one successful restore, without using Open, refreshes the welcome
panel so the restored chats show up under Recent Chats. It calls the exported
`openWelcomeScreen({force: true})`, which is what core's private `refreshWelcomeScreen` does, and
only when `getCurrentChatId() === undefined && chat.length === 0`. That call runs
`chat.splice(0, 0)` on an already-empty array, so the live chat array is never actually changed.

## Errors and edge cases

| Situation | Behaviour |
|---|---|
| Report fails | The popup body shows the error and a **Retry** button; nothing else loads. |
| View returns 403 (token replaced by the Clean-Up dialog or another tab) | Re-report once and retry the same hash. A second failure marks that row "couldn't read". |
| View returns 404 (the backup was pruned after the list loaded) | The row disappears, and a group left empty disappears. The character's backup count is updated. |
| Unparseable backup | Listed under **Unreadable**, with Preview and Restore disabled. |
| Import returns `{error: true}` or a non-2xx status | The row shows **Restore failed**, with an error toast. The import is a single file copy, so nothing partial remains. |
| Diff finds zero or several new files | Treated as success with no file name: no Open button, and a toast says where to find it. |
| Popup closed or character switched mid-download | Downloads are aborted. Running restores finish and report by toast. |
| `/api/characters/chats` returns `{error: true}` | Treated as "no current chats". |
| The Data Maid session is still open when the page unloads | It's harmless: the server replaces or drops the token on the next report. |

## Safety invariants

Each of these is re-verified by reading the code at review time, not taken from comments.

1. **The live chat is never touched.** The extension never writes `context.chat` or
   `chatMetadata`, and never loads a backup into the open chat. Restores go straight to disk
   through the import endpoint. The only core-state write is the `characters[id].chat` pointer in
   Open's missing-pointer case.
2. **Nothing is ever deleted.** No source file (outside `test/` and `docs/`) contains
   `data-maid/delete` or `chats/delete`, and a unit test asserts this.
3. **Lock discipline.** Queue and in-flight tracking is added inside `try` and removed in
   `finally`.
4. **Characters are read late.** Character data is read when the popup opens, never cached from
   init.
5. **Positioning.** Native `Popup` only: no `position: fixed`, no portal, no body-appended
   overlays.
6. **No hardcoded extension paths.** No `third-party/<Name>` strings. All markup is built in
   JavaScript, so no template path is needed.
7. **Backup content is inert.** Everything from a backup reaches the DOM through `textContent` or
   attributes set with `setAttribute`, never through `innerHTML`.

## Testing

**Unit tests (`node --test`, pure logic, run with a timeout and heap cap):**

- **`backupNames`**
  - The parser handles keys that contain underscores, and rejects settings backups and other
    stray files.
  - **Key parity:** `characterBackupKey` matches the server rule, computed with the real
    `sanitize-filename`, for every avatar in `data/default-user/characters/` plus crafted cases:
    illegal characters, control characters, trailing dots and spaces, reserved names, Zalgo and
    other non-ASCII text, and a name over 255 bytes. The test resolves SillyTavern's
    `node_modules/sanitize-filename` and **skips with a message** if it isn't found, rather than
    assuming a path.
  - Matching drops keys that match zero or several characters.
- **`chatSummary`:** a normal header, a missing `integrity` (falls back to `create_date`), an
  unparseable header, the excerpt length, and message counting.
- **`grouping`:** grouping by chat ID, ordering, and status precedence (`restored` over `exists`
  over `deleted`).
- **`dataMaidClient`** (mocked `fetch`): 403 → re-report → retry succeeds; a second 403 fails; 404
  becomes "gone"; `closeSession` calls finalize.
- **`restore`** (mocked `fetch`): the import's form fields; the folder check comes before the
  import; the diff with one, zero and several new files; the queue runs jobs one at a time; a
  failed job releases its tracking.
- **Source check:** no `data-maid/delete` or `chats/delete` outside `test/` and `docs/`.

**Browser wiring** (the button observer, popup DOM, Open) has **no automated tests by design**. It
is verified by a live Playwright pass on `default-user` against `https://192.168.7.201:8000`:

1. The button appears on the welcome screen and comes back after the panel is rebuilt (open and
   close a chat).
2. The popup lists the 23 characters. Cerberus Sisters shows one **Deleted** group with 50
   snapshots.
3. Preview shows the conversation as plain text, scrolled to the end.
4. Restore produces exactly one new file, byte-identical to the backup, and the group changes to
   **Restored**.
5. Open lands in that chat, and **no other new file appears** in the character's chat folder.
6. Cleanup: remove the test file, unless the user chooses to keep the Cerberus Sisters restore.

Per the project memory, a live page saves `settings.json`, so the relevant fields are snapshotted
before the run and any side effects are reported. Open also rewrites the character's card through
core's normal `openCharacterChat` save, which is expected core behaviour.

## Refinements from planning (2026-09-23)

Found while writing the implementation plan (`2026-09-23-backup-browser-plan.md`). They take
precedence over the sections above where they differ.

- **Header privacy is a hard rule.** On this deployment a backup's header carries Weyland's
  decoded master prompt (`chat_metadata.variables.ravteg`, about 45k characters) and about 256
  chat variables.
  - Only `user_name` (or its legacy alias, the top-level `name`), `character_name`, `create_date` and `integrity` ever leave the parser.
  - Nothing else from a header, and no raw backup text, is ever rendered, logged, cached or offered
    as a download.
  - Unit tests and the source-scan test enforce this.
- **The kill switch doesn't apply.** Weyland's QR kill switch (`ExtCheck`) matches three exact
  extension names, none of which is this one.
- **Unknown status also confirms.** While a character's current chats are still loading, or if
  loading failed, Restore asks for the same inline confirmation as **Exists**.
- **Restore also confirms on a chat already restored this session** (its group is tagged Restored,
  or a restore of it returned no file name), with its own note. A confirm click within 400 ms of
  arming is ignored, so a double-click can't skip the note. Snapshots not read yet show as a "N
  backups still to read…" line.
- **Import's `character_name` is sanitized** with the ported `sanitize-filename`. Core uses it
  unsanitized as a path segment.
- **Data Maid finalize waits for the restore queue to go idle,** so a restore still running after
  the popup closes keeps a valid token.
- **Core modules are imported by absolute URL** (`/script.js`, `/scripts/welcome-screen.js`).
  Core's `index.html` sets `<base href="/">`, so these are the same module instances, and the
  import works from either extension tree.
- **Opening a chat saves it.** The Weyland QR writes chat variables on every chat open, so a save
  (and a backup) follows. On a character at the 50-backup cap that prunes its oldest backup. The
  live test is therefore split across characters:
  - **Belle:** Exists confirm and restore.
  - **Briar:** stale-pointer Open, below the cap.
  - **Muse:** valid-pointer Open, below the cap.
  - **Cerberus Sisters:** browse and preview. Open only if the user keeps that restore.

## Open decisions

- Whether the live test's Cerberus Sisters restore is kept (the user may want that chat back) or
  deleted afterwards. To be decided with the user before the live pass.
