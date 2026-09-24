# Weyland-BackupBrowser

Browse the automatic chat backups SillyTavern keeps, and restore any of them as a new chat.

Open the welcome screen (no chat open) and select **Backups**, next to **Temporary Chat**.

- Pick a character to see its backups grouped by original chat, tagged **Deleted**,
  **Exists** or **Restored**.
- **Preview** shows a snapshot's messages as plain text.
- **Restore** adds the snapshot to the character's chat list as a new chat through
  SillyTavern's own import. Existing chats are never changed.
- After a restore, **Open** jumps into the restored chat.

## Limits

- **Backups are a rolling window.** SillyTavern keeps the latest 50 saves per character,
  shared by all of that character's chats. Chatting, or just opening a chat, pushes the oldest
  ones out. Restore everything you need before opening any of them.
- Character chats only. Group chats, and backups of deleted or renamed characters, are hidden.
- A restored copy of a chat that still exists shares that chat's memory book and chat
  variables. Restore asks for confirmation first. Restoring a chat you already restored this session asks again too.
- Backups are read through SillyTavern's Data Maid (User Settings → Clean-Up). Keep the Clean-Up
  dialog and this browser from being open at the same time: whichever opens second takes over the
  single Data Maid token.

## Safety

- The extension never deletes anything, and never writes the open chat.
- Backup headers contain the chat's metadata, including Weyland's prompt variables. Only the
  persona name, character name, creation date and chat id are ever read out of them. Nothing else
  is shown, logged, cached or downloadable.

## Development

```bash
timeout 120 node --max-old-space-size=512 --test
```

Pure logic lives in `lib/` and is unit-tested. The popup and button in `lib/ui/` are verified
live. Design and plan: `docs/specs/`.
