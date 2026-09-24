# Weyland-BackupBrowser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A client-side SillyTavern extension that adds a **Backups** button to the welcome screen,
lets the user browse each character's automatic chat backups grouped by original chat, preview
them, and restore any snapshot as a new chat.

**Architecture:** Pure-logic modules in `lib/` handle parsing, grouping and the HTTP calls. Each
HTTP-facing module takes `fetchImpl` and `getRequestHeaders` as parameters, so all of them are
unit-tested in Node. Backups are listed and read through SillyTavern's stock Data Maid endpoints,
and restored through core's own `/api/chats/import`. The UI in `lib/ui/` is a native SillyTavern
`Popup` built with DOM APIs only. `index.js` wires it all together and is the only file that
imports core modules.

**Tech Stack:** Plain ES modules with no build step and no dependencies. Tests use `node --test`
(Node 24). The runtime is SillyTavern 1.13.3 (`SillyTavern.getContext()`, `Popup`, `t`), and the
live check uses Playwright.

**Spec:** `docs/specs/2026-09-23-backup-browser-design.md`. Read it before starting any task.

## Global Constraints

- **Extension root:**
  `/home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-BackupBrowser`.
  - It is its own git repo, on branch `main`, with remote `origin`
    (`git@github.com:aerosplat-dev/Weyland-BackupBrowser.git`).
  - **Never commit in the parent WeylandTavern repo**, and never push unless the user asks.
  - Every commit step uses exactly this pattern, with explicit paths:
    `cd /home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-BackupBrowser && test "$(git rev-parse --show-toplevel)" = "$PWD" && git add <paths> && git commit -m "<message>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`
  - After each commit, check that `git show --stat HEAD` lists only your files.
- **Test command:** always bounded, from the extension root:
  `timeout 120 node --max-old-space-size=512 --test`.
  - The whole suite must pass at the end of every task.
  - `package.json` has `"type": "module"`, and there are no npm dependencies.
- **Endpoints used, and no others:**
  - `POST /api/data-maid/report`, `GET /api/data-maid/view`, `POST /api/data-maid/finalize`
  - `POST /api/characters/chats`, `POST /api/chats/get`, `POST /api/chats/import`
  - **Never** call Data Maid's delete, the chat delete endpoint, or the chat save endpoint.
    `test/invariants.test.js` enforces this.
- **Core access:**
  - Use `SillyTavern.getContext()` for everything it provides.
  - Only `index.js` imports core modules, and it imports only `setActiveCharacter` from
    `'/script.js'` and `openWelcomeScreen` from `'/scripts/welcome-screen.js'`.
  - **Keep these absolute specifiers; don't "fix" them to relative paths.**
    - Core's `index.html` has `<base href="/">`, so these URLs are the same module instances core
      loaded.
    - The absolute form keeps working whether the extension is installed in the per-user tree or
      the bundled tree. Upstream SillyTavern's own `chat-backups.js` uses the same form.
    - A relative `../../../../script.js` only works from `third-party/`.
- **Node-safe modules:** every file in `lib/` must import cleanly in Node. Touch browser globals
  (`document`, `toastr`, `requestAnimationFrame`, `SillyTavern`) only inside functions, never at
  module top level.
- **Header privacy (hard rule):**
  - A backup's first line carries Weyland's decoded master prompt
    (`chat_metadata.variables.ravteg`, about 45k characters on this deployment) and about 256
    chat variables.
  - Only `user_name` (or its legacy alias, the top-level `name`), `character_name`, `create_date` and `chat_metadata.integrity` may leave the
    parser.
  - Never render, log, cache or offer a download of any other header content or of raw backup
    text.
  - Never `console.log` anything. Use `console.warn`/`console.error` with messages only, never
    backup text, and never a `JSON.parse` error, because those quote the input.
- **DOM text:** use only `textContent` and `setAttribute`. No `innerHTML`, `outerHTML` or
  `insertAdjacentHTML`.
- **Overlays:** the native `Popup` only. No `position: fixed`. Every class and id is prefixed
  `wbb-`.
- **Core state:**
  - Never write the live chat array or chat metadata.
  - The only core-state write anywhere is `characters[id].chat = <restored name>` in
    `lib/openChat.js`.
- **Locks:**
  - Add any in-progress tracking (`Set.add`, busy flag) as the **first statement inside `try`**,
    and remove it in `finally`.
  - Browser-facing async entry points (`handleOpenBrowser`, the `whenIdle`-then-finalize chain,
    restore handlers) catch their own errors: no unhandled rejections.
- **Manifest values:**
  - `display_name: "Weyland-BackupBrowser"`, `author: "weyland-tavern"`, `version: "1.0.0"`
  - `loading_order: 500`, `auto_update: false`, `minimum_client_version: "1.13.3"`
  - `homePage: "https://github.com/aerosplat-dev/Weyland-BackupBrowser"`
- **Strings:**
  - User-facing strings go through `context.t` as a template tag.
  - Log lines are prefixed `[Weyland-BackupBrowser]`.
- **The live deployment is used concurrently by the user.**
  - `manifest.json` is created in **Task 10, only after every file it loads exists**. From then
    on, a reload of the user's tab loads the extension. The controller tells the user before
    dispatching Task 10.
  - Live testing is done by the controller (Task 11), against `https://192.168.7.201:8000` as
    `default-user`.
  - The password comes from the `WT_PASSWORD` environment variable and is **never written into any
    file**.

## Refinements to the spec made during planning

These are also recorded at the end of the spec.

1. **UNKNOWN status needs the confirm step too.** While current chats are still loading, or if
   loading them failed, Restore needs the same inline confirm as **Exists**.
2. **The import's `character_name` is sanitized** with the ported `sanitizeFilename`. Core uses it
   unsanitized as a path segment, so a `/` in a character name would break the restore.
3. **Data Maid finalize waits until the restore queue is idle** (`restoreQueue.whenIdle()`), so a
   restore still running after the popup closes keeps a valid token.
4. **A scoped CSS rule makes the popup content a flex column,**
   `.popup:has(.wbb-root) .popup-content`, so the two panes scroll independently. It doesn't touch
   core CSS.
5. **Extra module boundaries:** `lib/format.js`, `lib/summaryLoader.js`, `lib/openChat.js`,
   `lib/ui/dom.js`, `lib/ui/chatsView.js` and `lib/ui/previewPopup.js`. `lib/existingChats.js`
   exports a `createChatsApi` factory.

## File map

| File | Responsibility | Task |
|---|---|---|
| `package.json` | `"type": "module"`, `npm test` | 1 |
| `lib/backupNames.js` | Backup file-name parsing, the character key (port of the server rule and `sanitize-filename`), and matching backups to characters | 1 |
| `test/invariants.test.js` | Source scan enforcing the safety rules | 1 |
| `lib/chatSummary.js` | Header-safe summary, chat id, and preview message list | 2 |
| `lib/format.js` | Size, time and `create_date` formatting | 2 |
| `lib/grouping.js` | Groups snapshots by chat, with status and ordering | 3 |
| `lib/dataMaidClient.js` | The only Data Maid caller: report, view (403 retry, 404 means gone), finalize | 4 |
| `lib/existingChats.js` | Current chat list, chat headers, and the chats-folder check | 5 |
| `lib/restore.js` | Restore queue, import form, and the restore flow | 6 |
| `lib/summaryLoader.js` | Reads with bounded concurrency, the session summary cache, and abort | 7 |
| `lib/openChat.js` | Opens a restored chat without recreating a deleted one | 8 |
| `lib/ui/dom.js` | `el()` and `iconButton()` helpers | 9 |
| `lib/ui/chatsView.js` | DOM for the chat groups, snapshot rows and the Unreadable section | 9 |
| `lib/ui/previewPopup.js` | Plain-text preview in a second popup | 9 |
| `lib/ui/browserPopup.js` | Popup state and orchestration (session, panes, restore, open) | 9 |
| `style.css` | Popup layout | 9 |
| `test/imports.test.js` | Every `lib/` module loads in Node | 9 |
| `lib/ui/welcomeButton.js` | Keeps the Backups button in the welcome panel | 10 |
| `index.js` | Wiring and core imports | 10 |
| `manifest.json` | Extension manifest (lands last) | 10 |
| `README.md` | User and developer notes | 11 |

---

### Task 1: Package, backup names, and invariant guards

**Files:**
- Create: `package.json`
- Create: `lib/backupNames.js`
- Create: `test/backupNames.test.js`
- Create: `test/invariants.test.js`

**Interfaces:**
- Produces:
  - `parseBackupFileName(name: string): {key: string, stamp: string} | null`
  - `sanitizeFilename(input: string): string`
  - `characterBackupKey(avatar: string): string`
  - `matchBackupsToCharacters(backups: BackupRecord[], characters: {avatar?: string, name?: string}[]): CharacterBackups[]`
  - `BackupRecord = {name: string, hash: string, size: number, mtime: number}`
  - `CharacterBackups = {avatar: string, name: string, backups: BackupRecord[]}`, with backups
    newest first (by `mtime`), and the list ordered by newest backup.

- [ ] **Step 1: Create `package.json`**

```json
{
    "private": true,
    "type": "module",
    "scripts": {
        "test": "node --test"
    }
}
```

- [ ] **Step 2: Write the failing tests**

`test/backupNames.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
    characterBackupKey,
    matchBackupsToCharacters,
    parseBackupFileName,
    sanitizeFilename,
} from '../lib/backupNames.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Walks up from `start` until `relative` exists; null if it never does. */
function findUpward(start, relative) {
    let dir = start;
    for (;;) {
        const candidate = path.join(dir, relative);
        if (fs.existsSync(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

const sanitizePackage = findUpward(here, path.join('node_modules', 'sanitize-filename', 'package.json'));
const realSanitize = sanitizePackage ? createRequire(sanitizePackage)('./index.js') : null;
const skipParity = realSanitize ? false : 'sanitize-filename was not found above this extension';
const serverKey = (avatar) => realSanitize(String(avatar).replace('.png', ''))
    .replace(/[^a-z0-9]/gi, '_')
    .toLowerCase();

const CRAFTED = [
    'Bap.png',
    'Cerberus Sisters.png',
    'Professor Akiyama.png',
    'Lyris & Vesper.png',
    'Ṇ̶̰̼͘a̶͍̅́̒r̵̓̏̉̈́ā̸͒̔̄.png',
    'a:b*c?d.png',
    'tab\there.png',
    'trailing dots....png',
    'con.png',
    'LPT1.txt.png',
    '...png',
    'emoji 😀 name.png',
    'x.png.png',
    `${'é'.repeat(200)}.png`,
    `${'😀'.repeat(70)}.png`,
    'noext',
];

test('parseBackupFileName splits the key from the timestamp; keys may contain underscores', () => {
    assert.deepEqual(
        parseBackupFileName('chat_cerberus_sisters_20260921-125222.jsonl'),
        { key: 'cerberus_sisters', stamp: '20260921-125222' },
    );
    assert.deepEqual(
        parseBackupFileName('chat_bap_20260908-105331.jsonl'),
        { key: 'bap', stamp: '20260908-105331' },
    );
    assert.deepEqual(
        parseBackupFileName('chat_a_20260101-000000_20260102-000000.jsonl'),
        { key: 'a_20260101-000000', stamp: '20260102-000000' },
    );
});

test('parseBackupFileName rejects everything that is not a chat backup', () => {
    for (const name of [
        'settings_default-user_20260908-105331.json',
        'chat_bap_20260908-105331.json',
        'chat_bap.jsonl',
        'chat__20260908-105331.jsonl', // an empty key can't be tied to a character
        '_sysprompt',
        '',
        null,
        undefined,
    ]) {
        assert.equal(parseBackupFileName(name), null, String(name));
    }
});

test('characterBackupKey reproduces known backup keys', () => {
    assert.equal(characterBackupKey('Bap.png'), 'bap');
    assert.equal(characterBackupKey('Cerberus Sisters.png'), 'cerberus_sisters');
    assert.equal(characterBackupKey('Professor Akiyama.png'), 'professor_akiyama');
    // sanitize-filename removes illegal characters before the underscore pass
    assert.equal(characterBackupKey('a:b.png'), 'ab');
    // the server only drops the first ".png"
    assert.equal(characterBackupKey('x.png.png'), 'x_png');
});

test('sanitizeFilename matches the real sanitize-filename package', { skip: skipParity }, () => {
    for (const input of [...CRAFTED, '\u0080ctrl', ' ', '.', '..', 'a'.repeat(300)]) {
        assert.equal(sanitizeFilename(input), realSanitize(input), JSON.stringify(input));
    }
});

test('characterBackupKey matches the server rule for crafted avatars', { skip: skipParity }, () => {
    for (const avatar of CRAFTED) {
        assert.equal(characterBackupKey(avatar), serverKey(avatar), avatar);
    }
});

test('characterBackupKey matches the server rule for every avatar on this deployment', { skip: skipParity }, (t) => {
    const charactersDir = findUpward(here, 'characters');
    if (!charactersDir) {
        t.skip('no characters folder above this extension');
        return;
    }
    const avatars = fs.readdirSync(charactersDir).filter((file) => file.endsWith('.png'));
    for (const avatar of avatars) {
        assert.equal(characterBackupKey(avatar), serverKey(avatar), avatar);
    }
});

const backup = (name, mtime) => ({ name, hash: `hash-${name}`, size: 10, mtime });

test('matchBackupsToCharacters ties backups to characters, newest first, and drops orphans', () => {
    const characters = [
        { avatar: 'Bap.png', name: 'Bap' },
        { avatar: 'Cerberus Sisters.png', name: 'Cerberus Sisters' },
        { avatar: 'Kai.png', name: 'Kai' },
    ];
    const result = matchBackupsToCharacters([
        backup('chat_bap_20260908-105331.jsonl', 100),
        backup('chat_bap_20260908-105341.jsonl', 300),
        backup('chat_cerberus_sisters_20260921-125222.jsonl', 200),
        backup('chat_ghost_20260101-000000.jsonl', 999),
        backup('settings_default-user_20260101-000000.json', 999),
    ], characters);

    assert.deepEqual(
        result.map((entry) => [entry.avatar, entry.name, entry.backups.map((b) => b.mtime)]),
        [
            ['Bap.png', 'Bap', [300, 100]],
            ['Cerberus Sisters.png', 'Cerberus Sisters', [200]],
        ],
    );
});

test('matchBackupsToCharacters drops keys shared by several characters', () => {
    const characters = [
        { avatar: 'Bap.png', name: 'Bap' },
        { avatar: 'bap.png', name: 'bap' },
        { avatar: 'Kai.png', name: 'Kai' },
    ];
    const result = matchBackupsToCharacters([
        backup('chat_bap_20260908-105331.jsonl', 1),
        backup('chat_kai_20260908-105331.jsonl', 2),
    ], characters);
    assert.deepEqual(result.map((entry) => entry.avatar), ['Kai.png']);
});

test('matchBackupsToCharacters ignores characters without an avatar', () => {
    const result = matchBackupsToCharacters(
        [backup('chat_bap_20260908-105331.jsonl', 1)],
        [{ name: 'No avatar' }, null, { avatar: 'Bap.png', name: 'Bap' }],
    );
    assert.deepEqual(result.map((entry) => entry.avatar), ['Bap.png']);
});
```

`test/invariants.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIPPED_DIRECTORIES = new Set(['test', 'docs', 'node_modules', '.git']);

function sourceFiles(dir) {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIPPED_DIRECTORIES.has(entry.name)) files.push(...sourceFiles(full));
        } else if (/\.(js|css|html)$/.test(entry.name)) {
            files.push(full);
        }
    }
    return files;
}

const FORBIDDEN = [
    { pattern: /data-maid\/delete/, why: 'the extension never deletes backups' },
    { pattern: /chats\/delete/, why: 'the extension never deletes chats' },
    { pattern: /chats\/save/, why: 'restores go through import, which does not create or evict a backup' },
    { pattern: /\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML/, why: 'backup content is only ever inserted as text' },
    { pattern: /position:\s*fixed/, why: 'the native Popup is the only overlay' },
    { pattern: /third-party\//, why: 'no hardcoded extension location' },
    {
        pattern: /\bchat\.(push|splice|pop|shift|unshift)\s*\(|\bchat\.length\s*=(?!=)|chatMetadata|chat_metadata\s*\[|saveChat|saveMetadata|updateChatMetadata/,
        why: 'the live chat and its metadata are never written',
    },
    { pattern: /\.\s*variables\b|\[\s*['"]variables['"]\s*\]/, why: 'backup headers carry chat variables (including the decoded master prompt); they are never read' },
    { pattern: /createObjectURL/, why: 'backups are never offered as a download' },
    { pattern: /console\.log\(/, why: 'nothing is logged except warnings and errors, and never backup text' },
];

test('source files keep the safety invariants', () => {
    const files = sourceFiles(root);
    assert.ok(files.length > 0, 'no source files found');
    for (const file of files) {
        const text = fs.readFileSync(file, 'utf8');
        for (const { pattern, why } of FORBIDDEN) {
            assert.doesNotMatch(text, pattern, `${path.relative(root, file)}: ${why}`);
        }
    }
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-BackupBrowser && timeout 120 node --max-old-space-size=512 --test`

Expected: FAIL. `test/backupNames.test.js` can't import `../lib/backupNames.js` (module not found), and
the invariants test fails with "no source files found".

- [ ] **Step 4: Write `lib/backupNames.js`**

```js
/**
 * Chat backup file names, and the key SillyTavern 1.13.3 derives from a character's avatar.
 * Mirrors backupChat() in src/endpoints/chats.js and sanitize-filename 1.6.3.
 */

export const BACKUP_FILE_PATTERN = /^chat_(.+)_(\d{8}-\d{6})\.jsonl$/;

const ILLEGAL_RE = /[\/\?<>\\:\*\|"]/g;
const CONTROL_RE = /[\x00-\x1f\x80-\x9f]/g;
const RESERVED_RE = /^\.+$/;
const WINDOWS_RESERVED_RE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const WINDOWS_TRAILING_RE = /[\. ]+$/;
const MAX_FILENAME_BYTES = 255;

const encoder = new TextEncoder();

function isHighSurrogate(code) {
    return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code) {
    return code >= 0xdc00 && code <= 0xdfff;
}

/** Port of truncate-utf8-bytes 1.0.2: cut to at most `byteLength` UTF-8 bytes. */
function truncateUtf8Bytes(text, byteLength) {
    let total = 0;
    for (let i = 0; i < text.length; i += 1) {
        let segment = text[i];
        if (isHighSurrogate(text.charCodeAt(i)) && isLowSurrogate(text.charCodeAt(i + 1))) {
            i += 1;
            segment += text[i];
        }
        total += encoder.encode(segment).length;
        if (total === byteLength) return text.slice(0, i + 1);
        if (total > byteLength) return text.slice(0, i - segment.length + 1);
    }
    return text;
}

/**
 * Port of sanitize-filename 1.6.3 with its default (empty) replacement.
 * @param {string} input
 * @returns {string}
 */
export function sanitizeFilename(input) {
    const sanitized = String(input)
        .replace(ILLEGAL_RE, '')
        .replace(CONTROL_RE, '')
        .replace(RESERVED_RE, '')
        .replace(WINDOWS_RESERVED_RE, '')
        .replace(WINDOWS_TRAILING_RE, '');
    return truncateUtf8Bytes(sanitized, MAX_FILENAME_BYTES);
}

/**
 * The key backupChat() writes into `chat_<key>_<stamp>.jsonl` for a character chat.
 * @param {string} avatar The character's avatar file name, e.g. "Cerberus Sisters.png".
 * @returns {string}
 */
export function characterBackupKey(avatar) {
    const directoryName = String(avatar).replace('.png', '');
    return sanitizeFilename(directoryName).replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

/**
 * @param {unknown} name
 * @returns {{key: string, stamp: string} | null}
 */
export function parseBackupFileName(name) {
    if (typeof name !== 'string') return null;
    const match = BACKUP_FILE_PATTERN.exec(name);
    return match ? { key: match[1], stamp: match[2] } : null;
}

/**
 * @typedef {object} BackupRecord
 * @property {string} name
 * @property {string} hash
 * @property {number} size
 * @property {number} mtime
 */

/**
 * @typedef {object} CharacterBackups
 * @property {string} avatar
 * @property {string} name
 * @property {BackupRecord[]} backups Newest first.
 */

/**
 * Ties each backup to the one current character whose key matches. Keys that match no
 * character, or several characters, are dropped, as are names that aren't chat backups.
 * @param {BackupRecord[]} backups
 * @param {Array<{avatar?: string, name?: string} | null | undefined>} characters
 * @returns {CharacterBackups[]} Ordered by each character's newest backup.
 */
export function matchBackupsToCharacters(backups, characters) {
    const ownersByKey = new Map();
    for (const character of characters) {
        if (typeof character?.avatar !== 'string' || character.avatar === '') continue;
        const key = characterBackupKey(character.avatar);
        const owners = ownersByKey.get(key) ?? [];
        owners.push(character);
        ownersByKey.set(key, owners);
    }

    const byAvatar = new Map();
    for (const backup of backups) {
        const parsed = parseBackupFileName(backup?.name);
        if (!parsed) continue;
        const owners = ownersByKey.get(parsed.key);
        if (!owners || owners.length !== 1) continue;
        const [owner] = owners;
        let entry = byAvatar.get(owner.avatar);
        if (!entry) {
            entry = { avatar: owner.avatar, name: String(owner.name ?? owner.avatar), backups: [] };
            byAvatar.set(owner.avatar, entry);
        }
        entry.backups.push(backup);
    }

    const result = [...byAvatar.values()];
    for (const entry of result) entry.backups.sort((a, b) => b.mtime - a.mtime);
    result.sort((a, b) => b.backups[0].mtime - a.backups[0].mtime);
    return result;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-BackupBrowser && timeout 120 node --max-old-space-size=512 --test`

Expected: PASS, with none skipped. On this deployment `sanitize-filename` and the `characters`
folder both exist above the extension, so all three parity tests run.

- [ ] **Step 6: Commit**

```bash
cd /home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-BackupBrowser && test "$(git rev-parse --show-toplevel)" = "$PWD" && git add package.json lib/backupNames.js test/backupNames.test.js test/invariants.test.js && git commit -m "Parse backup names and tie them to characters; guard safety invariants" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Header-safe chat summary and display formatting

**Files:**
- Create: `lib/chatSummary.js`
- Create: `lib/format.js`
- Create: `test/chatSummary.test.js`
- Create: `test/format.test.js`

**Interfaces:**
- Produces, from `lib/chatSummary.js`:
  - `EXCERPT_LENGTH = 300`
  - `chatIdFromHeader(header: object): string | null`. Returns `"integrity:<uuid>"`, else
    `"created:<create_date>"`, else `null`.
  - `summarizeBackup(text: string): ChatSummary | null`. Returns `null` when the header is
    missing, unparseable, or would be rejected by core import.
  - `ChatSummary = {userName: string, characterName: string, createDate: string, chatId: string|null, messageCount: number, lastMessage: {name: string, excerpt: string, sendDate: string} | null}`
  - `parseBackupMessages(text: string): {name: string, sendDate: string, text: string, isUser: boolean}[]`.
    The header line is never included.
- Produces, from `lib/format.js`:
  - `formatSize(bytes: number): string`
  - `formatTime(ms: number, locale?: string): string`
  - `formatCreateDate(createDate: string, locale?: string): string`

- [ ] **Step 1: Write the failing tests**

`test/chatSummary.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    EXCERPT_LENGTH,
    chatIdFromHeader,
    parseBackupMessages,
    summarizeBackup,
} from '../lib/chatSummary.js';

const SECRET = 'SECRET-MASTER-PROMPT-TEXT';

const HEADER = {
    user_name: 'Rob',
    character_name: 'Cerberus Sisters',
    create_date: '2026-09-11@19h59m15s',
    chat_metadata: {
        integrity: 'ae2e15be-0ec5-43ee-877c-2e27b15e899b',
        variables: { ravteg: SECRET, postrav: SECRET },
        note_prompt: SECRET,
        world_info: 'Chat Book',
    },
};

const backupText = (header, messages) => [header, ...messages].map((line) => JSON.stringify(line)).join('\n');

test('summarizes the header fields and the last message', () => {
    const summary = summarizeBackup(backupText(HEADER, [
        { name: 'Cerberus Sisters', is_user: false, mes: 'Hello', send_date: 'September 21, 2026 12:40pm' },
        { name: 'Rob', is_user: true, mes: 'Hi there', send_date: 'September 21, 2026 12:52pm' },
    ]));
    assert.deepEqual(summary, {
        userName: 'Rob',
        characterName: 'Cerberus Sisters',
        createDate: '2026-09-11@19h59m15s',
        chatId: 'integrity:ae2e15be-0ec5-43ee-877c-2e27b15e899b',
        messageCount: 2,
        lastMessage: { name: 'Rob', excerpt: 'Hi there', sendDate: 'September 21, 2026 12:52pm' },
    });
});

test('never carries header content beyond the display fields', () => {
    const summary = summarizeBackup(backupText(HEADER, [{ name: 'Rob', mes: 'x' }]));
    assert.ok(!JSON.stringify(summary).includes(SECRET));
    assert.deepEqual(
        Object.keys(summary).sort(),
        ['characterName', 'chatId', 'createDate', 'lastMessage', 'messageCount', 'userName'],
    );
});

test('chatIdFromHeader prefers integrity and falls back to create_date', () => {
    assert.equal(chatIdFromHeader({ create_date: 'c', chat_metadata: { integrity: 'u' } }), 'integrity:u');
    assert.equal(chatIdFromHeader({ create_date: 'c', chat_metadata: { integrity: '' } }), 'created:c');
    assert.equal(chatIdFromHeader({ create_date: 'c' }), 'created:c');
    assert.equal(chatIdFromHeader({}), null);
    assert.equal(chatIdFromHeader(null), null);
});

test('counts non-empty message lines and takes the last parseable one', () => {
    const text = `${backupText(HEADER, [{ name: 'A', mes: 'one' }])}\n{broken\n\n`;
    const summary = summarizeBackup(text);
    assert.equal(summary.messageCount, 2);
    assert.deepEqual(summary.lastMessage, { name: 'A', excerpt: 'one', sendDate: '' });
});

test('a header-only backup has no messages', () => {
    const summary = summarizeBackup(JSON.stringify(HEADER));
    assert.equal(summary.messageCount, 0);
    assert.equal(summary.lastMessage, null);
});

test('long last messages keep their ending', () => {
    const mes = `${'a'.repeat(10)}${'b'.repeat(EXCERPT_LENGTH)}`;
    const summary = summarizeBackup(backupText(HEADER, [{ name: 'A', mes }]));
    assert.equal(summary.lastMessage.excerpt, `…${'b'.repeat(EXCERPT_LENGTH)}`);
});

test('headers that core import would reject are unreadable', () => {
    for (const text of ['', 'not json', '[]', '"text"', 'null', JSON.stringify({ character_name: 'x' })]) {
        assert.equal(summarizeBackup(text), null, text);
    }
    assert.equal(summarizeBackup(JSON.stringify({ name: 'x' })).userName, 'x');
    assert.equal(summarizeBackup(undefined), null);
});

test('parseBackupMessages lists messages only, never the header', () => {
    const text = `${backupText(HEADER, [
        { name: 'Cerberus Sisters', is_user: false, mes: 'Hello\nthere', send_date: 'd1' },
        { name: 'Rob', is_user: true, mes: 'Hi', send_date: 'd2', extra: { note: SECRET } },
        { name: 'System', is_system: true },
    ])}\n{broken`;
    const messages = parseBackupMessages(text);
    assert.deepEqual(messages, [
        { name: 'Cerberus Sisters', sendDate: 'd1', text: 'Hello\nthere', isUser: false },
        { name: 'Rob', sendDate: 'd2', text: 'Hi', isUser: true },
        { name: 'System', sendDate: '', text: '', isUser: false },
    ]);
    assert.ok(!JSON.stringify(messages).includes(SECRET));
    assert.deepEqual(parseBackupMessages(undefined), []);
});
```

`test/format.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { formatCreateDate, formatSize, formatTime } from '../lib/format.js';

test('formatSize uses B, KB and MB', () => {
    assert.equal(formatSize(512), '512 B');
    assert.equal(formatSize(2048), '2 KB');
    assert.equal(formatSize(3359358), '3.2 MB');
    assert.equal(formatSize(Number.NaN), '');
    assert.equal(formatSize(-1), '');
});

test('formatTime formats an epoch-ms instant and ignores non-numbers', () => {
    const ms = new Date(2026, 8, 21, 12, 52).getTime();
    assert.equal(
        formatTime(ms, 'en-US'),
        new Date(ms).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }),
    );
    assert.equal(formatTime(Number.NaN, 'en-US'), '');
});

test('formatCreateDate reads SillyTavern create_date strings as local time', () => {
    const expected = formatTime(new Date(2026, 8, 11, 19, 59, 15).getTime(), 'en-US');
    assert.equal(formatCreateDate('2026-09-11@19h59m15s', 'en-US'), expected);
    assert.equal(formatCreateDate('2026-9-1@7h5m3s', 'en-US'), formatTime(new Date(2026, 8, 1, 7, 5, 3).getTime(), 'en-US'));
    assert.equal(formatCreateDate('something else', 'en-US'), 'something else');
    assert.equal(formatCreateDate(undefined, 'en-US'), '');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-BackupBrowser && timeout 120 node --max-old-space-size=512 --test`

Expected: FAIL, because `../lib/chatSummary.js` and `../lib/format.js` are not found.

- [ ] **Step 3: Write `lib/chatSummary.js`**

```js
/**
 * Reads backup text. The header line carries the chat's whole metadata; only user_name,
 * character_name, create_date and the integrity id ever leave this module.
 */

export const EXCERPT_LENGTH = 300;

/** @returns {object|null} The parsed line when it is a JSON object, otherwise null. */
function parseLine(line) {
    try {
        const value = JSON.parse(line);
        return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch {
        return null;
    }
}

/**
 * The stable identity of a chat, read from its header line.
 * @param {object|null|undefined} header
 * @returns {string|null}
 */
export function chatIdFromHeader(header) {
    const integrity = header?.chat_metadata?.integrity;
    if (typeof integrity === 'string' && integrity !== '') return `integrity:${integrity}`;
    const createDate = header?.create_date;
    if (typeof createDate === 'string' && createDate !== '') return `created:${createDate}`;
    return null;
}

/** The check core's /api/chats/import applies to a JSONL header. */
function isImportableHeader(header) {
    return header !== null && (header.user_name !== undefined || header.name !== undefined);
}

function excerpt(text) {
    return text.length > EXCERPT_LENGTH ? `…${text.slice(-EXCERPT_LENGTH)}` : text;
}

/**
 * @typedef {object} ChatSummary
 * @property {string} userName
 * @property {string} characterName
 * @property {string} createDate
 * @property {string|null} chatId
 * @property {number} messageCount
 * @property {{name: string, excerpt: string, sendDate: string}|null} lastMessage
 */

/**
 * @param {string} text Backup file contents (JSONL).
 * @returns {ChatSummary|null} null when the header is missing or core import would reject it.
 */
export function summarizeBackup(text) {
    if (typeof text !== 'string') return null;
    const lines = text.split('\n');
    const header = parseLine(lines[0]);
    if (!isImportableHeader(header)) return null;

    const messageLines = lines.slice(1).filter((line) => line.trim() !== '');
    let lastMessage = null;
    for (let i = messageLines.length - 1; i >= 0; i -= 1) {
        const message = parseLine(messageLines[i]);
        if (message) {
            lastMessage = {
                name: String(message.name ?? ''),
                excerpt: excerpt(typeof message.mes === 'string' ? message.mes : ''),
                sendDate: String(message.send_date ?? ''),
            };
            break;
        }
    }

    return {
        userName: String(header.user_name ?? header.name ?? ''),
        characterName: String(header.character_name ?? ''),
        createDate: typeof header.create_date === 'string' ? header.create_date : '',
        chatId: chatIdFromHeader(header),
        messageCount: messageLines.length,
        lastMessage,
    };
}

/**
 * Every message of a backup, in order, for the read-only preview. The header line is skipped.
 * @param {string} text
 * @returns {{name: string, sendDate: string, text: string, isUser: boolean}[]}
 */
export function parseBackupMessages(text) {
    if (typeof text !== 'string') return [];
    return text.split('\n').slice(1)
        .map(parseLine)
        .filter((message) => message !== null)
        .map((message) => ({
            name: String(message.name ?? ''),
            sendDate: String(message.send_date ?? ''),
            text: typeof message.mes === 'string' ? message.mes : '',
            isUser: message.is_user === true,
        }));
}
```

- [ ] **Step 4: Write `lib/format.js`**

```js
const CREATE_DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})@(\d{1,2})h(\d{1,2})m(\d{1,2})s/;

/**
 * @param {number} bytes
 * @returns {string}
 */
export function formatSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * @param {number} ms Epoch milliseconds.
 * @param {string} [locale]
 * @returns {string}
 */
export function formatTime(ms, locale) {
    if (!Number.isFinite(ms)) return '';
    return new Date(ms).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * SillyTavern's create_date ("2026-09-11@19h59m15s") as a local date and time.
 * @param {string} createDate
 * @param {string} [locale]
 * @returns {string}
 */
export function formatCreateDate(createDate, locale) {
    const match = CREATE_DATE_RE.exec(createDate ?? '');
    if (!match) return String(createDate ?? '');
    const [, year, month, day, hour, minute, second] = match.map(Number);
    return formatTime(new Date(year, month - 1, day, hour, minute, second).getTime(), locale);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-BackupBrowser && timeout 120 node --max-old-space-size=512 --test`

Expected: PASS, and the invariants test still passes.

- [ ] **Step 6: Commit**

```bash
cd /home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-BackupBrowser && test "$(git rev-parse --show-toplevel)" = "$PWD" && git add lib/chatSummary.js lib/format.js test/chatSummary.test.js test/format.test.js && git commit -m "Summarize backups without exposing header metadata; add display formatting" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Group snapshots by chat

**Files:**
- Create: `lib/grouping.js`
- Create: `test/grouping.test.js`

**Interfaces:**
- Consumes: `ChatSummary` (Task 2), whose `chatId` values look like `integrity:<uuid>` or
  `created:<date>`.
- Produces:
  - `GROUP_STATUS = {RESTORED: 'restored', EXISTS: 'exists', DELETED: 'deleted', UNKNOWN: 'unknown'}`
  - `SNAPSHOT_STATE = {PENDING: 'pending', READY: 'ready', UNREADABLE: 'unreadable', ERROR: 'error'}`
  - `Snapshot = {name, hash, size, mtime, state, summary: ChatSummary|null}`
  - `groupSnapshots(snapshots: Snapshot[], existingChats: {fileName: string, chatId: string|null}[] | null, restored: Map<string, string>): {groups: ChatGroup[], problems: Snapshot[], pending: Snapshot[]}`
    - `existingChats` is `null` while unknown.
    - `restored` maps chatId to the restored file name.
  - `ChatGroup = {key: string, createDate: string, userName: string, status: string, fileName: string|null, snapshots: Snapshot[]}`,
    with snapshots newest first, and groups ordered by newest snapshot.

- [ ] **Step 1: Write the failing test**

`test/grouping.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { GROUP_STATUS, SNAPSHOT_STATE, groupSnapshots } from '../lib/grouping.js';

const { READY, PENDING, UNREADABLE, ERROR } = SNAPSHOT_STATE;

const summary = (chatId, createDate = 'created', userName = 'Rob') => ({
    userName, characterName: 'X', createDate, chatId, messageCount: 1, lastMessage: null,
});
const snap = (hash, mtime, state, snapshotSummary = null) => ({
    name: `${hash}.jsonl`, hash, size: 1, mtime, state, summary: snapshotSummary,
});

test('groups ready snapshots by chat, newest group and newest snapshot first', () => {
    const { groups } = groupSnapshots([
        snap('a1', 10, READY, summary('integrity:a')),
        snap('b1', 30, READY, summary('integrity:b')),
        snap('a2', 20, READY, summary('integrity:a')),
    ], [], new Map());
    assert.deepEqual(
        groups.map((group) => [group.key, group.snapshots.map((s) => s.hash)]),
        [['integrity:b', ['b1']], ['integrity:a', ['a2', 'a1']]],
    );
});

test('status precedence is restored, then exists, then deleted', () => {
    const snapshots = [
        snap('a', 3, READY, summary('integrity:a')),
        snap('b', 2, READY, summary('integrity:b')),
        snap('c', 1, READY, summary('integrity:c')),
    ];
    const existing = [
        { fileName: 'A.jsonl', chatId: 'integrity:a' },
        { fileName: 'B.jsonl', chatId: 'integrity:b' },
    ];
    const restored = new Map([['integrity:a', 'A restored.jsonl']]);
    const { groups } = groupSnapshots(snapshots, existing, restored);
    assert.deepEqual(groups.map((g) => [g.key, g.status, g.fileName]), [
        ['integrity:a', GROUP_STATUS.RESTORED, 'A restored.jsonl'],
        ['integrity:b', GROUP_STATUS.EXISTS, 'B.jsonl'],
        ['integrity:c', GROUP_STATUS.DELETED, null],
    ]);
});

test('status is unknown until the current chats are known, unless restored', () => {
    const snapshots = [snap('a', 2, READY, summary('integrity:a')), snap('b', 1, READY, summary('integrity:b'))];
    const { groups } = groupSnapshots(snapshots, null, new Map([['integrity:b', 'B.jsonl']]));
    assert.deepEqual(groups.map((g) => g.status), [GROUP_STATUS.UNKNOWN, GROUP_STATUS.RESTORED]);
});

test('pending, unreadable and failed snapshots stay out of the groups', () => {
    const { groups, problems, pending } = groupSnapshots([
        snap('p1', 5, PENDING),
        snap('u1', 4, UNREADABLE),
        snap('e1', 6, ERROR),
        snap('r1', 1, READY, summary('integrity:a')),
        snap('p2', 7, PENDING),
    ], [], new Map());
    assert.deepEqual(groups.map((g) => g.key), ['integrity:a']);
    assert.deepEqual(problems.map((s) => s.hash), ['e1', 'u1']);
    assert.deepEqual(pending.map((s) => s.hash), ['p2', 'p1']);
});

test('a snapshot without a chat id gets a group of its own and never matches a current chat', () => {
    const { groups } = groupSnapshots([
        snap('x', 2, READY, summary(null)),
        snap('y', 1, READY, summary(null)),
    ], [{ fileName: 'Z.jsonl', chatId: null }], new Map());
    assert.deepEqual(groups.map((g) => [g.key, g.status]), [
        ['snapshot:x', GROUP_STATUS.DELETED],
        ['snapshot:y', GROUP_STATUS.DELETED],
    ]);
});

test('the group header uses the newest snapshot', () => {
    const { groups } = groupSnapshots([
        snap('old', 1, READY, summary('integrity:a', 'first', 'Alex')),
        snap('new', 2, READY, summary('integrity:a', 'second', 'Rob')),
    ], [], new Map());
    assert.equal(groups[0].createDate, 'second');
    assert.equal(groups[0].userName, 'Rob');
});

test('inputs are not reordered', () => {
    const snapshots = [snap('a1', 1, READY, summary('integrity:a')), snap('a2', 2, READY, summary('integrity:a'))];
    groupSnapshots(snapshots, [], new Map());
    assert.deepEqual(snapshots.map((s) => s.hash), ['a1', 'a2']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-BackupBrowser && timeout 120 node --max-old-space-size=512 --test`

Expected: FAIL, because `../lib/grouping.js` is not found.

- [ ] **Step 3: Write `lib/grouping.js`**

```js
export const GROUP_STATUS = Object.freeze({
    RESTORED: 'restored',
    EXISTS: 'exists',
    DELETED: 'deleted',
    UNKNOWN: 'unknown',
});

export const SNAPSHOT_STATE = Object.freeze({
    PENDING: 'pending',
    READY: 'ready',
    UNREADABLE: 'unreadable',
    ERROR: 'error',
});

/**
 * @typedef {object} Snapshot
 * @property {string} name
 * @property {string} hash
 * @property {number} size
 * @property {number} mtime
 * @property {'pending'|'ready'|'unreadable'|'error'} state
 * @property {import('./chatSummary.js').ChatSummary|null} summary Set when state is 'ready'.
 */

/**
 * @typedef {object} ChatGroup
 * @property {string} key The chat id, or `snapshot:<hash>` when a backup has none.
 * @property {string} createDate
 * @property {string} userName
 * @property {'restored'|'exists'|'deleted'|'unknown'} status
 * @property {string|null} fileName The restored or current chat file, when there is one.
 * @property {Snapshot[]} snapshots Newest first.
 */

const newestFirst = (a, b) => b.mtime - a.mtime;

/**
 * @param {Snapshot[]} snapshots
 * @param {{fileName: string, chatId: string|null}[]|null} existingChats null while unknown.
 * @param {Map<string, string>} restored chatId -> file name restored this page session.
 * @returns {{groups: ChatGroup[], problems: Snapshot[], pending: Snapshot[]}}
 */
export function groupSnapshots(snapshots, existingChats, restored) {
    const byKey = new Map();
    const problems = [];
    const pending = [];

    for (const snapshot of snapshots) {
        if (snapshot.state === SNAPSHOT_STATE.PENDING) {
            pending.push(snapshot);
            continue;
        }
        if (snapshot.state !== SNAPSHOT_STATE.READY || !snapshot.summary) {
            problems.push(snapshot);
            continue;
        }
        const key = snapshot.summary.chatId ?? `snapshot:${snapshot.hash}`;
        let group = byKey.get(key);
        if (!group) {
            group = { key, createDate: '', userName: '', status: GROUP_STATUS.UNKNOWN, fileName: null, snapshots: [] };
            byKey.set(key, group);
        }
        group.snapshots.push(snapshot);
    }

    const groups = [...byKey.values()];
    for (const group of groups) {
        group.snapshots.sort(newestFirst);
        const latest = group.snapshots[0].summary;
        group.createDate = latest.createDate;
        group.userName = latest.userName;

        const restoredFile = restored.get(group.key);
        const existing = existingChats?.find((chat) => chat.chatId === group.key);
        if (restoredFile) {
            group.status = GROUP_STATUS.RESTORED;
            group.fileName = restoredFile;
        } else if (existing) {
            group.status = GROUP_STATUS.EXISTS;
            group.fileName = existing.fileName;
        } else if (existingChats) {
            group.status = GROUP_STATUS.DELETED;
        }
    }

    groups.sort((a, b) => newestFirst(a.snapshots[0], b.snapshots[0]));
    problems.sort(newestFirst);
    pending.sort(newestFirst);
    return { groups, problems, pending };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-BackupBrowser && timeout 120 node --max-old-space-size=512 --test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-BackupBrowser && test "$(git rev-parse --show-toplevel)" = "$PWD" && git add lib/grouping.js test/grouping.test.js && git commit -m "Group backup snapshots by original chat with a status per chat" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Data Maid client

**Files:**
- Create: `lib/dataMaidClient.js`
- Create: `test/dataMaidClient.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `DataMaidError extends Error`, with a `status: number` property.
  - `createDataMaidClient({fetchImpl, getRequestHeaders})` returns `{openSession, fetchBackup, closeSession}`:
    - `openSession(signal?): Promise<Session>`, where
      `Session = {token: string, backups: BackupRecord[], refreshing: Promise<void>|null}`.
    - `fetchBackup(session, hash, signal?): Promise<{status: 'ok', blob: Blob} | {status: 'gone'}>`.
      It throws `DataMaidError` on any other failure. On a 403 it re-reports once, with a single
      shared refresh, and retries.
    - `closeSession(session): Promise<void>` never rejects.

- [ ] **Step 1: Write the failing test**

`test/dataMaidClient.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { DataMaidError, createDataMaidClient } from '../lib/dataMaidClient.js';

const headers = () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf' });
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
});

const REPORT = {
    images: [{ name: 'img.png', hash: 'i', size: 1, mtime: 1 }],
    chatBackups: [
        { name: 'chat_bap_20260908-105331.jsonl', hash: 'h1', size: 5, mtime: 100, parent: 'x' },
        { name: 42, hash: 'bad', size: 1, mtime: 1 },
    ],
    settingsBackups: [{ name: 'settings_default-user_1.json', hash: 's', size: 1, mtime: 1 }],
};

/**
 * @param {object} options
 * @param {string[]} options.tokens Tokens handed out by successive reports.
 * @param {(hash: string, token: string) => Response} [options.view]
 */
function fakeServer({ tokens, view = () => new Response('hello') }) {
    const calls = [];
    let reportCount = 0;
    const fetchImpl = async (url, init = {}) => {
        calls.push({ url, init });
        await Promise.resolve();
        if (url === '/api/data-maid/report') {
            const token = tokens[reportCount];
            reportCount += 1;
            return jsonResponse({ report: REPORT, token });
        }
        if (url.startsWith('/api/data-maid/view?')) {
            const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
            return view(params.get('hash'), params.get('token'));
        }
        if (url === '/api/data-maid/finalize') return new Response(null, { status: 204 });
        throw new Error(`unexpected request ${url}`);
    };
    return { calls, fetchImpl, reports: () => reportCount };
}

test('openSession keeps only valid chat backups and the token', async () => {
    const server = fakeServer({ tokens: ['t1'] });
    const client = createDataMaidClient({ fetchImpl: server.fetchImpl, getRequestHeaders: headers });
    const session = await client.openSession();
    assert.equal(session.token, 't1');
    assert.deepEqual(session.backups, [{ name: 'chat_bap_20260908-105331.jsonl', hash: 'h1', size: 5, mtime: 100 }]);
    assert.equal(server.calls[0].init.method, 'POST');
    assert.deepEqual(server.calls[0].init.headers, headers());
});

test('openSession rejects on an HTTP error or a missing token', async () => {
    const failing = createDataMaidClient({
        fetchImpl: async () => new Response('', { status: 500 }),
        getRequestHeaders: headers,
    });
    await assert.rejects(failing.openSession(), (error) => error instanceof DataMaidError && error.status === 500);

    const tokenless = createDataMaidClient({
        fetchImpl: async () => jsonResponse({ report: REPORT }),
        getRequestHeaders: headers,
    });
    await assert.rejects(tokenless.openSession(), DataMaidError);
});

test('fetchBackup returns the file as a blob and passes the signal', async () => {
    const server = fakeServer({ tokens: ['t 1'] });
    const client = createDataMaidClient({ fetchImpl: server.fetchImpl, getRequestHeaders: headers });
    const session = await client.openSession();
    const signal = new AbortController().signal;
    const result = await client.fetchBackup(session, 'h/1', signal);
    assert.equal(result.status, 'ok');
    assert.equal(await result.blob.text(), 'hello');
    const viewCall = server.calls[1];
    assert.equal(viewCall.url, '/api/data-maid/view?hash=h%2F1&token=t%201');
    assert.equal(viewCall.init.signal, signal);
});

test('fetchBackup reports a pruned backup as gone', async () => {
    const server = fakeServer({ tokens: ['t1'], view: () => new Response('', { status: 404 }) });
    const client = createDataMaidClient({ fetchImpl: server.fetchImpl, getRequestHeaders: headers });
    const session = await client.openSession();
    assert.deepEqual(await client.fetchBackup(session, 'h1'), { status: 'gone' });
});

test('a 403 re-reports once and retries with the new token', async () => {
    const server = fakeServer({
        tokens: ['t1', 't2'],
        view: (hash, token) => (token === 't2' ? new Response('fresh') : new Response('', { status: 403 })),
    });
    const client = createDataMaidClient({ fetchImpl: server.fetchImpl, getRequestHeaders: headers });
    const session = await client.openSession();
    const result = await client.fetchBackup(session, 'h1');
    assert.equal(await result.blob.text(), 'fresh');
    assert.equal(session.token, 't2');
    assert.equal(server.reports(), 2);
});

test('a second 403 fails with DataMaidError', async () => {
    const server = fakeServer({ tokens: ['t1', 't2'], view: () => new Response('', { status: 403 }) });
    const client = createDataMaidClient({ fetchImpl: server.fetchImpl, getRequestHeaders: headers });
    const session = await client.openSession();
    await assert.rejects(client.fetchBackup(session, 'h1'), (error) => error instanceof DataMaidError && error.status === 403);
});

test('concurrent 403s share one refresh', async () => {
    const server = fakeServer({
        tokens: ['t1', 't2', 't3'],
        view: (hash, token) => (token === 't1' ? new Response('', { status: 403 }) : new Response(hash)),
    });
    const client = createDataMaidClient({ fetchImpl: server.fetchImpl, getRequestHeaders: headers });
    const session = await client.openSession();
    const results = await Promise.all(['a', 'b', 'c'].map((hash) => client.fetchBackup(session, hash)));
    assert.deepEqual(await Promise.all(results.map((r) => r.blob.text())), ['a', 'b', 'c']);
    assert.equal(server.reports(), 2);
    assert.equal(session.token, 't2');
});

test('closeSession finalizes the token and never rejects', async () => {
    const server = fakeServer({ tokens: ['t1'] });
    const client = createDataMaidClient({ fetchImpl: server.fetchImpl, getRequestHeaders: headers });
    const session = await client.openSession();
    await client.closeSession(session);
    const finalize = server.calls.at(-1);
    assert.equal(finalize.url, '/api/data-maid/finalize');
    assert.equal(finalize.init.method, 'POST');
    assert.deepEqual(JSON.parse(finalize.init.body), { token: 't1' });

    const broken = createDataMaidClient({
        fetchImpl: async () => { throw new Error('offline'); },
        getRequestHeaders: headers,
    });
    await broken.closeSession({ token: 'x' });
    await broken.closeSession(null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-BackupBrowser && timeout 120 node --max-old-space-size=512 --test`

Expected: FAIL, because `../lib/dataMaidClient.js` is not found.

- [ ] **Step 3: Write `lib/dataMaidClient.js`**

```js
/**
 * The only module that talks to SillyTavern's Data Maid endpoints (/api/data-maid/*).
 * It lists backups (report), reads one (view) and releases the token (finalize). Nothing else.
 */

export class DataMaidError extends Error {
    /**
     * @param {string} message
     * @param {number} status
     */
    constructor(message, status) {
        super(message);
        this.name = 'DataMaidError';
        this.status = status;
    }
}

function isBackupRecord(value) {
    return value !== null && typeof value === 'object'
        && typeof value.name === 'string'
        && typeof value.hash === 'string'
        && Number.isFinite(value.size)
        && Number.isFinite(value.mtime);
}

/**
 * @typedef {object} Session
 * @property {string} token Replaced when a view is refused and the report is re-run.
 * @property {import('./backupNames.js').BackupRecord[]} backups
 * @property {Promise<void>|null} refreshing A re-report in progress, shared by every caller.
 */

/**
 * @param {object} deps
 * @param {typeof fetch} deps.fetchImpl
 * @param {() => Record<string, string>} deps.getRequestHeaders
 */
export function createDataMaidClient({ fetchImpl, getRequestHeaders }) {
    async function requestReport(signal) {
        const response = await fetchImpl('/api/data-maid/report', {
            method: 'POST',
            headers: getRequestHeaders(),
            signal,
        });
        if (!response.ok) {
            throw new DataMaidError(`The backup list request failed (HTTP ${response.status})`, response.status);
        }
        const data = await response.json();
        if (typeof data?.token !== 'string' || data.token === '') {
            throw new DataMaidError('The backup list response had no token', response.status);
        }
        const records = Array.isArray(data.report?.chatBackups) ? data.report.chatBackups : [];
        return {
            token: data.token,
            backups: records.filter(isBackupRecord).map(({ name, hash, size, mtime }) => ({ name, hash, size, mtime })),
        };
    }

    /**
     * @param {AbortSignal} [signal]
     * @returns {Promise<Session>}
     */
    async function openSession(signal) {
        const { token, backups } = await requestReport(signal);
        return { token, backups, refreshing: null };
    }

    /** Re-runs the report once for every caller refused with the same token. */
    async function refreshToken(session, refusedToken) {
        if (session.token !== refusedToken) return;
        if (!session.refreshing) {
            session.refreshing = requestReport()
                .then(({ token }) => { session.token = token; })
                .finally(() => { session.refreshing = null; });
        }
        await session.refreshing;
    }

    /**
     * @param {Session} session
     * @param {string} hash
     * @param {AbortSignal} [signal]
     * @returns {Promise<{status: 'ok', blob: Blob} | {status: 'gone'}>}
     */
    async function fetchBackup(session, hash, signal) {
        for (let attempt = 0; ; attempt += 1) {
            const token = session.token;
            const url = `/api/data-maid/view?hash=${encodeURIComponent(hash)}&token=${encodeURIComponent(token)}`;
            const response = await fetchImpl(url, { method: 'GET', signal });
            if (response.ok) return { status: 'ok', blob: await response.blob() };
            if (response.status === 404) return { status: 'gone' };
            if (response.status === 403 && attempt === 0) {
                await refreshToken(session, token);
                continue;
            }
            throw new DataMaidError(`Reading the backup failed (HTTP ${response.status})`, response.status);
        }
    }

    /**
     * Releases the token. Never rejects: the server replaces or drops it on the next report anyway.
     * @param {Session|null|undefined} session
     */
    async function closeSession(session) {
        if (!session?.token) return;
        try {
            await fetchImpl('/api/data-maid/finalize', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ token: session.token }),
            });
        } catch {
            // Nothing to do; see above.
        }
    }

    return { openSession, fetchBackup, closeSession };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-BackupBrowser && timeout 120 node --max-old-space-size=512 --test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-BackupBrowser && test "$(git rev-parse --show-toplevel)" = "$PWD" && git add lib/dataMaidClient.js test/dataMaidClient.test.js && git commit -m "List and read backups through Data Maid with one shared token refresh" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Current chats of a character

**Files:**
- Create: `lib/existingChats.js`
- Create: `test/existingChats.test.js`

**Interfaces:**
- Consumes: `chatIdFromHeader(header)` from `lib/chatSummary.js` (Task 2).
- Produces: `createChatsApi({fetchImpl, getRequestHeaders})`, returning:
  - `listChatFiles(avatar: string, signal?): Promise<string[]>`: file names including `.jsonl`.
    Returns `[]` when core answers `{error: true}`, and throws on HTTP errors.
  - `listCurrentChats(avatar: string, signal?): Promise<{fileName: string, chatId: string|null}[]>`
  - `ensureChatFolder(avatar: string, signal?): Promise<void>`

- [ ] **Step 1: Write the failing test**

`test/existingChats.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { createChatsApi } from '../lib/existingChats.js';

const headers = () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf' });
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status });

function fakeFetch(route) {
    const calls = [];
    const fetchImpl = async (url, init) => {
        const body = JSON.parse(init.body);
        calls.push({ url, body, init });
        return route(url, body);
    };
    return { calls, fetchImpl };
}

test('listChatFiles asks for the simple list and keeps .jsonl names', async () => {
    const server = fakeFetch(() => jsonResponse([
        { file_name: 'Bap - 1.jsonl' },
        { file_name: 'notes.txt' },
        { nope: true },
    ]));
    const api = createChatsApi({ fetchImpl: server.fetchImpl, getRequestHeaders: headers });
    assert.deepEqual(await api.listChatFiles('Bap.png'), ['Bap - 1.jsonl']);
    assert.equal(server.calls[0].url, '/api/characters/chats');
    assert.deepEqual(server.calls[0].body, { avatar_url: 'Bap.png', simple: true });
    assert.equal(server.calls[0].init.method, 'POST');
    assert.deepEqual(server.calls[0].init.headers, headers());
});

test('listChatFiles treats {error: true} as no chats and throws on HTTP errors', async () => {
    const none = createChatsApi({ fetchImpl: fakeFetch(() => jsonResponse({ error: true })).fetchImpl, getRequestHeaders: headers });
    assert.deepEqual(await none.listChatFiles('Bap.png'), []);
    const broken = createChatsApi({ fetchImpl: fakeFetch(() => new Response('', { status: 500 })).fetchImpl, getRequestHeaders: headers });
    await assert.rejects(broken.listChatFiles('Bap.png'));
});

test('listCurrentChats reads each chat header for its id', async () => {
    const server = fakeFetch((url, body) => {
        if (url === '/api/characters/chats') return jsonResponse([{ file_name: 'Bap - 1.jsonl' }, { file_name: 'Bap - 2.jsonl' }]);
        if (body.file_name === 'Bap - 1') return jsonResponse([{ create_date: 'c1', chat_metadata: { integrity: 'u1' } }, { mes: 'hi' }]);
        return jsonResponse({});
    });
    const api = createChatsApi({ fetchImpl: server.fetchImpl, getRequestHeaders: headers });
    assert.deepEqual(await api.listCurrentChats('Bap.png'), [
        { fileName: 'Bap - 1.jsonl', chatId: 'integrity:u1' },
        { fileName: 'Bap - 2.jsonl', chatId: null },
    ]);
    assert.deepEqual(server.calls[1].body, { avatar_url: 'Bap.png', file_name: 'Bap - 1' });
    assert.equal(server.calls[1].url, '/api/chats/get');
});

test('listCurrentChats never reads headers when there are no chats', async () => {
    const server = fakeFetch(() => jsonResponse({ error: true }));
    const api = createChatsApi({ fetchImpl: server.fetchImpl, getRequestHeaders: headers });
    assert.deepEqual(await api.listCurrentChats('Bap.png'), []);
    assert.equal(server.calls.length, 1);
});

test('ensureChatFolder calls chats/get without a file name', async () => {
    const server = fakeFetch(() => jsonResponse({}));
    const api = createChatsApi({ fetchImpl: server.fetchImpl, getRequestHeaders: headers });
    await api.ensureChatFolder('Bap.png');
    assert.equal(server.calls[0].url, '/api/chats/get');
    assert.deepEqual(server.calls[0].body, { avatar_url: 'Bap.png' });

    const broken = createChatsApi({ fetchImpl: fakeFetch(() => new Response('', { status: 400 })).fetchImpl, getRequestHeaders: headers });
    await assert.rejects(broken.ensureChatFolder('Bap.png'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-BackupBrowser && timeout 120 node --max-old-space-size=512 --test`

Expected: FAIL, because `../lib/existingChats.js` is not found.

- [ ] **Step 3: Write `lib/existingChats.js`**

```js
import { chatIdFromHeader } from './chatSummary.js';

/**
 * A character's current chats, read through core's own endpoints.
 * @param {object} deps
 * @param {typeof fetch} deps.fetchImpl
 * @param {() => Record<string, string>} deps.getRequestHeaders
 */
export function createChatsApi({ fetchImpl, getRequestHeaders }) {
    function post(url, body, signal) {
        return fetchImpl(url, {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(body),
            signal,
        });
    }

    /**
     * @param {string} avatar
     * @param {AbortSignal} [signal]
     * @returns {Promise<string[]>} File names, including ".jsonl".
     */
    async function listChatFiles(avatar, signal) {
        const response = await post('/api/characters/chats', { avatar_url: avatar, simple: true }, signal);
        if (!response.ok) throw new Error(`The chat list request failed (HTTP ${response.status})`);
        const data = await response.json();
        // Core answers {error: true} when the folder is missing or holds no chats.
        if (!Array.isArray(data)) return [];
        return data
            .map((item) => item?.file_name)
            .filter((name) => typeof name === 'string' && name.endsWith('.jsonl'));
    }

    async function readChatHeader(avatar, fileName, signal) {
        const response = await post('/api/chats/get', {
            avatar_url: avatar,
            file_name: fileName.replace(/\.jsonl$/, ''),
        }, signal);
        if (!response.ok) return null;
        const data = await response.json();
        return Array.isArray(data) && data[0] !== null && typeof data[0] === 'object' ? data[0] : null;
    }

    /**
     * Only called after the listing returned files, so /api/chats/get never has to create a folder.
     * @param {string} avatar
     * @param {AbortSignal} [signal]
     * @returns {Promise<{fileName: string, chatId: string|null}[]>}
     */
    async function listCurrentChats(avatar, signal) {
        const files = await listChatFiles(avatar, signal);
        const chats = [];
        for (const fileName of files) {
            const header = await readChatHeader(avatar, fileName, signal);
            chats.push({ fileName, chatId: header ? chatIdFromHeader(header) : null });
        }
        return chats;
    }

    /**
     * Core's /api/chats/get creates the character's chats folder when called without a file name.
     * @param {string} avatar
     * @param {AbortSignal} [signal]
     */
    async function ensureChatFolder(avatar, signal) {
        const response = await post('/api/chats/get', { avatar_url: avatar }, signal);
        if (!response.ok) throw new Error(`The chat folder check failed (HTTP ${response.status})`);
    }

    return { listChatFiles, listCurrentChats, ensureChatFolder };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-BackupBrowser && timeout 120 node --max-old-space-size=512 --test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-BackupBrowser && test "$(git rev-parse --show-toplevel)" = "$PWD" && git add lib/existingChats.js test/existingChats.test.js && git commit -m "Read a character's current chats and their ids through core endpoints" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Restore queue and restore flow

**Files:**
- Create: `lib/restore.js`
- Create: `test/restore.test.js`

**Interfaces:**
- Consumes:
  - `summarizeBackup` (Task 2)
  - `sanitizeFilename` (Task 1)
  - `dataMaid.fetchBackup(session, hash, signal?)` (Task 4)
  - `chatsApi.listChatFiles(avatar)` and `chatsApi.ensureChatFolder(avatar)` (Task 5)
- Produces:
  - `createRestoreQueue()` returns `{enqueue, has, isBusy, subscribe, whenIdle}`:
    - `enqueue<T>(id: string, job: () => Promise<T>): Promise<T>`. Jobs run one at a time, in
      order.
    - `has(id): boolean` and `isBusy(): boolean`. Both are true while a job is queued or running.
    - `subscribe(listener: () => void): () => void`. The listener is called whenever the set of
      queued/running ids changes. The returned function unsubscribes.
    - `whenIdle(): Promise<void>`
  - `buildImportForm({blob, backupName, avatar, characterName, userName}): FormData`
  - `restoreSnapshot({dataMaid, chatsApi, session, character: {avatar, name}, snapshot: {name, hash}, fetchImpl, getRequestHeaders})`
    resolves to one of:
    - `{status: 'restored', fileName: string|null}`
    - `{status: 'gone'}`
    - `{status: 'unreadable'}`
    - `{status: 'failed', reason: string}`

    It throws only when reading the backup or checking the folder throws.

- [ ] **Step 1: Write the failing test**

`test/restore.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildImportForm, createRestoreQueue, restoreSnapshot } from '../lib/restore.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('queue runs jobs one at a time, in order', async () => {
    const queue = createRestoreQueue();
    const order = [];
    const gate = deferred();
    const first = queue.enqueue('a', async () => { order.push('a:start'); await gate.promise; order.push('a:end'); return 'A'; });
    const second = queue.enqueue('b', async () => { order.push('b:start'); return 'B'; });
    await tick();
    assert.deepEqual(order, ['a:start']);
    assert.equal(queue.has('b'), true);
    gate.resolve();
    assert.deepEqual(await Promise.all([first, second]), ['A', 'B']);
    assert.deepEqual(order, ['a:start', 'a:end', 'b:start']);
    assert.equal(queue.isBusy(), false);
});

test('queue tracking, notifications and whenIdle', async () => {
    const queue = createRestoreQueue();
    let notifications = 0;
    const unsubscribe = queue.subscribe(() => { notifications += 1; });
    const gate = deferred();
    const job = queue.enqueue('a', () => gate.promise);
    assert.equal(queue.has('a'), true);
    assert.equal(queue.isBusy(), true);
    let idle = false;
    const idlePromise = queue.whenIdle().then(() => { idle = true; });
    await tick();
    assert.equal(idle, false);
    gate.resolve('done');
    assert.equal(await job, 'done');
    await idlePromise;
    assert.equal(idle, true);
    assert.equal(queue.has('a'), false);
    assert.equal(notifications, 2);
    unsubscribe();
    await queue.enqueue('b', async () => {});
    assert.equal(notifications, 2);
});

test('a failing job rejects, releases its id and lets the next job run', async () => {
    const queue = createRestoreQueue();
    const failing = queue.enqueue('a', async () => { throw new Error('boom'); });
    const next = queue.enqueue('b', async () => 'ok');
    await assert.rejects(failing, /boom/);
    assert.equal(await next, 'ok');
    assert.equal(queue.has('a'), false);
    assert.equal(queue.isBusy(), false);
});

test('a throwing listener does not break the queue', async () => {
    const queue = createRestoreQueue();
    queue.subscribe(() => { throw new Error('listener'); });
    assert.equal(await queue.enqueue('a', async () => 1), 1);
    assert.equal(queue.isBusy(), false);
});

test('buildImportForm sends the backup bytes the way core import expects', async () => {
    const blob = new Blob(['{"user_name":"Rob"}\n{"mes":"é"}']);
    const form = buildImportForm({
        blob,
        backupName: 'chat_bap_20260908-105331.jsonl',
        avatar: 'Bap.png',
        characterName: 'A/B: C',
        userName: 'Rob',
    });
    const file = form.get('avatar');
    assert.ok(file instanceof File);
    assert.equal(file.name, 'chat_bap_20260908-105331.jsonl');
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), new Uint8Array(await blob.arrayBuffer()));
    assert.equal(form.get('file_type'), 'jsonl');
    assert.equal(form.get('avatar_url'), 'Bap.png');
    assert.equal(form.get('character_name'), 'AB C');
    assert.equal(form.get('user_name'), 'Rob');
    assert.equal(buildImportForm({ blob, backupName: 'x', avatar: 'y', characterName: '///', userName: '' }).get('character_name'), 'Restored chat');
});

const VALID = [
    JSON.stringify({ user_name: 'Rob', character_name: 'Bap', create_date: 'c', chat_metadata: { integrity: 'u' } }),
    JSON.stringify({ name: 'Bap', mes: 'hi' }),
].join('\n');

function setup({
    read = { status: 'ok', blob: new Blob([VALID]) },
    before = ['Bap - 1.jsonl'],
    after = ['Bap - 1.jsonl', 'Bap - 2 imported.jsonl'],
    importResponse = () => jsonResponse({ res: true }),
} = {}) {
    const calls = [];
    let listCount = 0;
    const deps = {
        dataMaid: {
            fetchBackup: async (session, hash) => { calls.push(['fetchBackup', hash]); return read; },
        },
        chatsApi: {
            listChatFiles: async (avatar) => {
                calls.push(['listChatFiles', avatar]);
                listCount += 1;
                if (listCount === 1) return before;
                if (after instanceof Error) throw after;
                return after;
            },
            ensureChatFolder: async (avatar) => { calls.push(['ensureChatFolder', avatar]); },
        },
        session: { token: 't' },
        character: { avatar: 'Bap.png', name: 'Bap' },
        snapshot: { name: 'chat_bap_20260908-105331.jsonl', hash: 'h1' },
        fetchImpl: async (url, init) => { calls.push(['fetch', url, init]); return importResponse(); },
        getRequestHeaders: (options) => { calls.push(['headers', options]); return { 'X-CSRF-Token': 'csrf' }; },
    };
    return { calls, deps };
}

test('restoreSnapshot reads, checks the folder, imports, and finds the new file', async () => {
    const { calls, deps } = setup();
    assert.deepEqual(await restoreSnapshot(deps), { status: 'restored', fileName: 'Bap - 2 imported.jsonl' });
    assert.deepEqual(calls.map((call) => call[0]), ['fetchBackup', 'listChatFiles', 'ensureChatFolder', 'headers', 'fetch', 'listChatFiles']);
    assert.deepEqual(calls[3][1], { omitContentType: true });
    const [, url, init] = calls[4];
    assert.equal(url, '/api/chats/import');
    assert.equal(init.method, 'POST');
    assert.deepEqual(init.headers, { 'X-CSRF-Token': 'csrf' });
    assert.ok(init.body instanceof FormData);
    assert.equal(init.body.get('user_name'), 'Rob');
    assert.equal(init.body.get('avatar_url'), 'Bap.png');
    assert.equal(await init.body.get('avatar').text(), VALID);
});

test('restoreSnapshot leaves the file name unknown unless exactly one file appeared', async () => {
    assert.deepEqual(await restoreSnapshot(setup({ after: ['Bap - 1.jsonl'] }).deps), { status: 'restored', fileName: null });
    assert.deepEqual(
        await restoreSnapshot(setup({ after: ['Bap - 1.jsonl', 'Bap - 2.jsonl', 'Bap - 3.jsonl'] }).deps),
        { status: 'restored', fileName: null },
    );
    assert.deepEqual(await restoreSnapshot(setup({ after: new Error('list failed') }).deps), { status: 'restored', fileName: null });
});

test('restoreSnapshot reports rejected and failed imports', async () => {
    assert.deepEqual(
        await restoreSnapshot(setup({ importResponse: () => jsonResponse({ error: true }) }).deps),
        { status: 'failed', reason: 'The import was rejected' },
    );
    assert.deepEqual(
        await restoreSnapshot(setup({ importResponse: () => new Response('', { status: 500 }) }).deps),
        { status: 'failed', reason: 'HTTP 500' },
    );
});

test('restoreSnapshot never imports a pruned or unreadable backup', async () => {
    const gone = setup({ read: { status: 'gone' } });
    assert.deepEqual(await restoreSnapshot(gone.deps), { status: 'gone' });
    assert.ok(!gone.calls.some((call) => call[0] === 'fetch'));

    const unreadable = setup({ read: { status: 'ok', blob: new Blob(['not json']) } });
    assert.deepEqual(await restoreSnapshot(unreadable.deps), { status: 'unreadable' });
    assert.ok(!unreadable.calls.some((call) => call[0] === 'fetch'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-BackupBrowser && timeout 120 node --max-old-space-size=512 --test`

Expected: FAIL, because `../lib/restore.js` is not found.

- [ ] **Step 3: Write `lib/restore.js`**

```js
import { sanitizeFilename } from './backupNames.js';
import { summarizeBackup } from './chatSummary.js';

/**
 * Runs restore jobs one at a time, in the order they were queued.
 */
export function createRestoreQueue() {
    /** @type {Set<string>} ids queued or running */
    const active = new Set();
    /** @type {Set<() => void>} */
    const listeners = new Set();
    let tail = Promise.resolve();

    function notify() {
        for (const listener of listeners) {
            try {
                listener();
            } catch {
                // A broken listener must not stall the queue.
            }
        }
    }

    /**
     * @template T
     * @param {string} id
     * @param {() => Promise<T>} job
     * @returns {Promise<T>}
     */
    async function enqueue(id, job) {
        try {
            active.add(id);
            notify();
            const previous = tail;
            let release;
            tail = new Promise((resolve) => { release = resolve; });
            try {
                await previous;
                return await job();
            } finally {
                release();
            }
        } finally {
            active.delete(id);
            notify();
        }
    }

    /** Resolves once nothing is queued or running. */
    async function whenIdle() {
        while (active.size > 0) {
            await tail;
        }
    }

    return {
        enqueue,
        whenIdle,
        has: (id) => active.has(id),
        isBusy: () => active.size > 0,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

/**
 * The multipart body core's /api/chats/import expects for a JSONL chat. Core uses
 * character_name unsanitized as part of the new file's path, so it is sanitized here.
 * @param {{blob: Blob, backupName: string, avatar: string, characterName: string, userName: string}} input
 * @returns {FormData}
 */
export function buildImportForm({ blob, backupName, avatar, characterName, userName }) {
    const form = new FormData();
    form.set('avatar', new File([blob], backupName, { type: 'application/octet-stream' }));
    form.set('file_type', 'jsonl');
    form.set('avatar_url', avatar);
    form.set('character_name', sanitizeFilename(characterName) || 'Restored chat');
    form.set('user_name', userName);
    return form;
}

/**
 * Restores one backup as a new chat of `character` through core's own import.
 * @returns {Promise<{status: 'restored', fileName: string|null} | {status: 'gone'} | {status: 'unreadable'} | {status: 'failed', reason: string}>}
 */
export async function restoreSnapshot({ dataMaid, chatsApi, session, character, snapshot, fetchImpl, getRequestHeaders }) {
    const read = await dataMaid.fetchBackup(session, snapshot.hash);
    if (read.status === 'gone') return { status: 'gone' };
    const summary = summarizeBackup(await read.blob.text());
    if (!summary) return { status: 'unreadable' };

    const before = new Set(await chatsApi.listChatFiles(character.avatar));
    await chatsApi.ensureChatFolder(character.avatar);

    const response = await fetchImpl('/api/chats/import', {
        method: 'POST',
        headers: getRequestHeaders({ omitContentType: true }),
        body: buildImportForm({
            blob: read.blob,
            backupName: snapshot.name,
            avatar: character.avatar,
            characterName: character.name,
            userName: summary.userName,
        }),
    });
    if (!response.ok) return { status: 'failed', reason: `HTTP ${response.status}` };
    const data = await response.json().catch(() => null);
    if (data?.res !== true) return { status: 'failed', reason: 'The import was rejected' };

    let fileName = null;
    try {
        const added = (await chatsApi.listChatFiles(character.avatar)).filter((name) => !before.has(name));
        fileName = added.length === 1 ? added[0] : null;
    } catch {
        // Restored, but the new file's name can't be confirmed.
    }
    return { status: 'restored', fileName };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-BackupBrowser && timeout 120 node --max-old-space-size=512 --test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-BackupBrowser && test "$(git rev-parse --show-toplevel)" = "$PWD" && git add lib/restore.js test/restore.test.js && git commit -m "Restore backups one at a time through core chat import" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Summary loader

**Files:**
- Create: `lib/summaryLoader.js`
- Create: `test/summaryLoader.test.js`

**Interfaces:**
- Consumes: `summarizeBackup` (Task 2) and `dataMaid.fetchBackup` (Task 4).
- Produces: `createSummaryLoader({dataMaid, summarize?, concurrency? = 4})`, returning:
  - `cached(snapshot: {hash, size, mtime}): ChatSummary | null | undefined`. `undefined` means not
    read yet, and `null` means unreadable.
  - `loadAll(session, snapshots, {signal?, onResult}): Promise<void>`:
    - `onResult(snapshot, result)` receives `{status: 'ok', summary}`, `{status: 'gone'}` or
      `{status: 'error', error}`.
    - It reads in the order given and never calls `onResult` after an abort.

- [ ] **Step 1: Write the failing test**

`test/summaryLoader.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { createSummaryLoader } from '../lib/summaryLoader.js';

const VALID = [
    JSON.stringify({ user_name: 'Rob', character_name: 'Bap', create_date: 'c', chat_metadata: { integrity: 'u' } }),
    JSON.stringify({ name: 'Bap', mes: 'hi' }),
].join('\n');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const snapshots = (...hashes) => hashes.map((hash, index) => ({ hash, size: 1, mtime: index }));

test('reads uncached snapshots once and caches summaries, including unreadable ones', async () => {
    const fetched = [];
    const dataMaid = {
        fetchBackup: async (session, hash) => {
            fetched.push(hash);
            return { status: 'ok', blob: new Blob([hash === 'bad' ? 'not json' : VALID]) };
        },
    };
    const loader = createSummaryLoader({ dataMaid });
    const list = snapshots('a', 'bad');
    const results = [];
    await loader.loadAll({}, list, { onResult: (snapshot, result) => results.push([snapshot.hash, result.status, result.summary?.userName ?? null]) });
    assert.deepEqual(results, [['a', 'ok', 'Rob'], ['bad', 'ok', null]]);
    assert.equal(loader.cached(list[0]).userName, 'Rob');
    assert.equal(loader.cached(list[1]), null);
    assert.equal(loader.cached({ hash: 'a', size: 2, mtime: 0 }), undefined);

    await loader.loadAll({}, list, { onResult: () => assert.fail('nothing left to read') });
    assert.deepEqual(fetched, ['a', 'bad']);
});

test('never runs more than `concurrency` reads at once, in the given order', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const started = [];
    const dataMaid = {
        fetchBackup: async (session, hash) => {
            started.push(hash);
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await tick();
            inFlight -= 1;
            return { status: 'ok', blob: new Blob([VALID]) };
        },
    };
    const loader = createSummaryLoader({ dataMaid, concurrency: 2 });
    await loader.loadAll({}, snapshots('a', 'b', 'c', 'd', 'e'), { onResult: () => {} });
    assert.equal(maxInFlight, 2);
    assert.deepEqual(started, ['a', 'b', 'c', 'd', 'e']);
});

test('passes the session and signal through', async () => {
    const seen = [];
    const signal = new AbortController().signal;
    const session = { token: 't' };
    const dataMaid = {
        fetchBackup: async (s, hash, sig) => { seen.push([s, sig]); return { status: 'ok', blob: new Blob([VALID]) }; },
    };
    await createSummaryLoader({ dataMaid }).loadAll(session, snapshots('a'), { signal, onResult: () => {} });
    assert.equal(seen[0][0], session);
    assert.equal(seen[0][1], signal);
});

test('stops after an abort and reports nothing more', async () => {
    const controller = new AbortController();
    const fetched = [];
    const results = [];
    const dataMaid = {
        fetchBackup: async (session, hash) => {
            fetched.push(hash);
            controller.abort();
            return { status: 'ok', blob: new Blob([VALID]) };
        },
    };
    const loader = createSummaryLoader({ dataMaid, concurrency: 1 });
    await loader.loadAll({}, snapshots('a', 'b', 'c'), { signal: controller.signal, onResult: (s) => results.push(s.hash) });
    assert.deepEqual(fetched, ['a']);
    assert.deepEqual(results, []);
});

test('reports gone and failed reads without caching them', async () => {
    const dataMaid = {
        fetchBackup: async (session, hash) => {
            if (hash === 'gone') return { status: 'gone' };
            throw new Error('network');
        },
    };
    const loader = createSummaryLoader({ dataMaid });
    const list = snapshots('gone', 'broken');
    const results = [];
    await loader.loadAll({}, list, { onResult: (snapshot, result) => results.push([snapshot.hash, result.status]) });
    assert.deepEqual(results.sort(), [['broken', 'error'], ['gone', 'gone']]);
    assert.equal(loader.cached(list[0]), undefined);
    assert.equal(loader.cached(list[1]), undefined);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-BackupBrowser && timeout 120 node --max-old-space-size=512 --test`

Expected: FAIL, because `../lib/summaryLoader.js` is not found.

- [ ] **Step 3: Write `lib/summaryLoader.js`**

```js
import { summarizeBackup } from './chatSummary.js';

export const DEFAULT_CONCURRENCY = 4;

function cacheKey(snapshot) {
    return `${snapshot.hash}:${snapshot.size}:${snapshot.mtime}`;
}

/**
 * Reads backups and remembers their summaries for the page session. Only summaries are kept,
 * never file text.
 * @param {object} deps
 * @param {{fetchBackup: Function}} deps.dataMaid
 * @param {(text: string) => import('./chatSummary.js').ChatSummary|null} [deps.summarize]
 * @param {number} [deps.concurrency]
 */
export function createSummaryLoader({ dataMaid, summarize = summarizeBackup, concurrency = DEFAULT_CONCURRENCY }) {
    /** @type {Map<string, import('./chatSummary.js').ChatSummary|null>} */
    const cache = new Map();

    /**
     * @param {{hash: string, size: number, mtime: number}} snapshot
     * @returns {import('./chatSummary.js').ChatSummary|null|undefined} undefined when not read yet.
     */
    function cached(snapshot) {
        const key = cacheKey(snapshot);
        return cache.has(key) ? cache.get(key) : undefined;
    }

    /**
     * Reads every snapshot not in the cache, in the order given, `concurrency` at a time.
     * @param {object} session
     * @param {Array<{hash: string, size: number, mtime: number}>} snapshots
     * @param {{signal?: AbortSignal, onResult: (snapshot: object, result: object) => void}} options
     */
    async function loadAll(session, snapshots, { signal, onResult }) {
        const queue = snapshots.filter((snapshot) => cached(snapshot) === undefined);
        let next = 0;

        async function worker() {
            while (next < queue.length && !signal?.aborted) {
                const snapshot = queue[next];
                next += 1;
                let result;
                try {
                    const read = await dataMaid.fetchBackup(session, snapshot.hash, signal);
                    if (read.status === 'gone') {
                        result = { status: 'gone' };
                    } else {
                        const summary = summarize(await read.blob.text());
                        cache.set(cacheKey(snapshot), summary);
                        result = { status: 'ok', summary };
                    }
                } catch (error) {
                    if (signal?.aborted) return;
                    result = { status: 'error', error };
                }
                if (signal?.aborted) return;
                onResult(snapshot, result);
            }
        }

        const workers = Math.min(concurrency, queue.length);
        await Promise.all(Array.from({ length: workers }, () => worker()));
    }

    return { cached, loadAll };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-BackupBrowser && timeout 120 node --max-old-space-size=512 --test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-BackupBrowser && test "$(git rev-parse --show-toplevel)" = "$PWD" && git add lib/summaryLoader.js test/summaryLoader.test.js && git commit -m "Read backup summaries with bounded concurrency and a session cache" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Open a restored chat

**Files:**
- Create: `lib/openChat.js`
- Create: `test/openChat.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks. Core functions are injected.
- Produces: `openRestoredChat(deps): Promise<boolean>`:
  - `deps = {characters, avatar, fileName, listChatFiles, selectCharacterById, getSelectedCharacterId, setActiveCharacter, saveSettingsDebounced, openCharacterChat}`
  - It resolves `false` when core refused to switch characters, and rejects when the avatar
    isn't found.

- [ ] **Step 1: Write the failing test**

`test/openChat.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { openRestoredChat } from '../lib/openChat.js';

const RESTORED = 'Briar - 2026-9-23 @16h 15m 57s 608ms imported.jsonl';
const RESTORED_NAME = 'Briar - 2026-9-23 @16h 15m 57s 608ms imported';

function setup({ pointer, files, selectWorks = true }) {
    const calls = [];
    const characters = [{ avatar: 'Other.png', chat: 'x' }, { avatar: 'Briar.png', chat: pointer }];
    let selected;
    const deps = {
        characters,
        avatar: 'Briar.png',
        fileName: RESTORED,
        listChatFiles: async (avatar) => { calls.push(['list', avatar]); return files; },
        selectCharacterById: async (id) => {
            calls.push(['select', id, characters[id].chat]);
            if (selectWorks) selected = id;
        },
        getSelectedCharacterId: () => (selected === undefined ? undefined : String(selected)),
        setActiveCharacter: (avatar) => { calls.push(['setActive', avatar]); },
        saveSettingsDebounced: () => { calls.push(['saveSettings']); },
        openCharacterChat: async (name) => { calls.push(['open', name]); },
    };
    return { calls, characters, deps };
}

test('a missing chat pointer is moved to the restored chat before selecting', async () => {
    const { calls, deps } = setup({ pointer: 'Briar - deleted', files: [RESTORED] });
    assert.equal(await openRestoredChat(deps), true);
    assert.deepEqual(calls, [
        ['list', 'Briar.png'],
        ['select', 1, RESTORED_NAME],
        ['setActive', 'Briar.png'],
        ['saveSettings'],
        ['open', RESTORED_NAME],
    ]);
});

test('a valid chat pointer is left alone and core switches chats itself', async () => {
    const { calls, characters, deps } = setup({ pointer: 'Briar - current', files: ['Briar - current.jsonl', RESTORED] });
    assert.equal(await openRestoredChat(deps), true);
    assert.deepEqual(calls[1], ['select', 1, 'Briar - current']);
    assert.deepEqual(calls.at(-1), ['open', RESTORED_NAME]);
    assert.equal(characters[1].chat, 'Briar - current');
});

test('stops when core refuses to switch characters', async () => {
    const { calls, deps } = setup({ pointer: 'Briar - current', files: ['Briar - current.jsonl'], selectWorks: false });
    assert.equal(await openRestoredChat(deps), false);
    assert.deepEqual(calls.map((call) => call[0]), ['list', 'select']);
});

test('rejects an unknown avatar', async () => {
    const { deps } = setup({ pointer: 'x', files: [] });
    await assert.rejects(openRestoredChat({ ...deps, avatar: 'Nobody.png' }), /Nobody\.png/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-BackupBrowser && timeout 120 node --max-old-space-size=512 --test`

Expected: FAIL, because `../lib/openChat.js` is not found.

- [ ] **Step 3: Write `lib/openChat.js`**

```js
/**
 * Opens a restored chat the way core's recent-chat opener does (openRecentCharacterChat in
 * public/scripts/welcome-screen.js), without first reloading a chat that no longer exists.
 * @param {object} deps
 * @param {Array<{avatar: string, chat: string}>} deps.characters Core's live characters array.
 * @param {string} deps.avatar
 * @param {string} deps.fileName The restored file, including ".jsonl".
 * @param {(avatar: string) => Promise<string[]>} deps.listChatFiles
 * @param {(id: number) => Promise<void>} deps.selectCharacterById
 * @param {() => (string|number|undefined)} deps.getSelectedCharacterId
 * @param {(avatar: string) => void} deps.setActiveCharacter
 * @param {() => void} deps.saveSettingsDebounced
 * @param {(chatName: string) => Promise<void>} deps.openCharacterChat
 * @returns {Promise<boolean>} false when core refused to switch characters.
 */
export async function openRestoredChat({
    characters,
    avatar,
    fileName,
    listChatFiles,
    selectCharacterById,
    getSelectedCharacterId,
    setActiveCharacter,
    saveSettingsDebounced,
    openCharacterChat,
}) {
    const characterId = characters.findIndex((character) => character?.avatar === avatar);
    if (characterId === -1) throw new Error(`Character not found: ${avatar}`);
    const chatName = fileName.replace(/\.jsonl$/, '');

    const files = await listChatFiles(avatar);
    if (!files.includes(`${characters[characterId].chat}.jsonl`)) {
        // The same assignment core's openCharacterChat makes first. Without it, selecting the
        // character would load its missing last chat, and core would recreate that chat as a
        // greeting-only file (a save that also prunes one of the character's backups).
        characters[characterId].chat = chatName;
    }

    await selectCharacterById(characterId);
    if (String(getSelectedCharacterId()) !== String(characterId)) return false;
    setActiveCharacter(avatar);
    saveSettingsDebounced();
    await openCharacterChat(chatName);
    return true;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-BackupBrowser && timeout 120 node --max-old-space-size=512 --test`

Expected: PASS, and the invariants test still passes. `characters[characterId].chat =` is not
matched by the chat-array guard.

- [ ] **Step 5: Commit**

```bash
cd /home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-BackupBrowser && test "$(git rev-parse --show-toplevel)" = "$PWD" && git add lib/openChat.js test/openChat.test.js && git commit -m "Open a restored chat without recreating a deleted one" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The backup browser popup

This task builds all the popup UI. It is DOM wiring with **no automated tests by design** (see
the spec's Testing section). `test/imports.test.js` makes sure every module still loads in Node,
and the controller verifies the behaviour live in Task 11. **No `manifest.json` yet:** nothing in
this task is loaded by the running app.

**Files:**
- Create: `lib/ui/dom.js`
- Create: `lib/ui/chatsView.js`
- Create: `lib/ui/previewPopup.js`
- Create: `lib/ui/browserPopup.js`
- Create: `style.css`
- Create: `test/imports.test.js`

**Interfaces:**
- Consumes:
  - `matchBackupsToCharacters` (Task 1)
  - `parseBackupMessages` (Task 2)
  - `formatSize`, `formatTime`, `formatCreateDate` (Task 2)
  - `GROUP_STATUS`, `SNAPSHOT_STATE`, `groupSnapshots` (Task 3)
  - the objects returned by `createDataMaidClient` (Task 4), `createChatsApi` (Task 5),
    `createRestoreQueue` (Task 6) and `createSummaryLoader` (Task 7)
- Produces:
  - `el(tag, {className?, text?, attrs?}, ...children): HTMLElement` and
    `iconButton({icon, label, className?, title?, onClick, disabled?}): HTMLButtonElement`, both
    from `lib/ui/dom.js`.
  - `restoredChatKey(avatar: string, chatId: string): string` from `lib/ui/browserPopup.js`.
  - `openBackupBrowser(deps: BrowserDeps): Promise<void>` from `lib/ui/browserPopup.js`. It
    resolves once the popup has closed. `BrowserDeps` is:
    - `context`: `SillyTavern.getContext()` taken when the popup opens
    - `dataMaid`, `chatsApi`, `summaryLoader`, `restoreQueue`
    - `restoredChats: Map<string, string>`
    - `restore({session, character, snapshot}) => Promise<RestoreResult>`
    - `openChat({avatar, fileName}) => Promise<boolean>`
    - `refreshWelcome() => Promise<void>`

- [ ] **Step 1: Write the failing import test**

`test/imports.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function jsFiles(dir) {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...jsFiles(full));
        else if (entry.name.endsWith('.js')) files.push(full);
    }
    return files;
}

test('every lib module loads in Node without touching browser globals', async () => {
    const files = jsFiles(path.join(root, 'lib'));
    for (const expected of ['ui/dom.js', 'ui/chatsView.js', 'ui/previewPopup.js', 'ui/browserPopup.js']) {
        assert.ok(files.includes(path.join(root, 'lib', expected)), `missing lib/${expected}`);
    }
    for (const file of files) {
        await import(pathToFileURL(file).href);
    }
});
```

Run: `cd /home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-BackupBrowser && timeout 120 node --max-old-space-size=512 --test`

Expected: FAIL with "missing lib/ui/dom.js".

- [ ] **Step 2: Write `lib/ui/dom.js`**

```js
/**
 * Creates an element. Text only ever goes in through textContent.
 * @param {string} tag
 * @param {{className?: string, text?: string, attrs?: Record<string, string>}} [options]
 * @param {...(Node|null|undefined|false)} children
 * @returns {HTMLElement}
 */
export function el(tag, { className, text, attrs } = {}, ...children) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    if (attrs) {
        for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    }
    for (const child of children) {
        if (child) node.append(child);
    }
    return node;
}

/**
 * A core-styled button with a Font Awesome icon and an optional label.
 * @param {{icon: string, label?: string, className?: string, title?: string, onClick: () => void, disabled?: boolean}} options
 * @returns {HTMLButtonElement}
 */
export function iconButton({ icon, label, className = '', title, onClick, disabled = false }) {
    const button = /** @type {HTMLButtonElement} */ (el(
        'button',
        { className: `menu_button menu_button_icon ${className}`.trim(), attrs: { type: 'button' } },
        el('i', { className: `fa-solid ${icon} fa-fw`, attrs: { 'aria-hidden': 'true' } }),
        label ? el('span', { text: label }) : null,
    ));
    if (title) button.title = title;
    if (disabled) {
        button.disabled = true;
        button.classList.add('disabled');
    }
    button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
    });
    return button;
}
```

- [ ] **Step 3: Write `lib/ui/chatsView.js`**

```js
import { formatCreateDate, formatSize, formatTime } from '../format.js';
import { GROUP_STATUS, SNAPSHOT_STATE } from '../grouping.js';
import { el, iconButton } from './dom.js';

/**
 * @typedef {object} RowState
 * @property {'queued'|'restoring'|'restored'|'failed'} kind
 * @property {string|null} [fileName]
 * @property {string} [message]
 */

/**
 * @typedef {object} ChatsViewOptions
 * @property {(strings: TemplateStringsArray, ...values: any[]) => string} t
 * @property {string} characterName
 * @property {Set<string>} expanded Group keys whose older snapshots are shown.
 * @property {Set<string>} confirming Snapshot hashes waiting for a second Restore click.
 * @property {Map<string, RowState>} rows Restore state per snapshot hash.
 * @property {(hash: string) => boolean} isQueued
 * @property {boolean} queueBusy
 * @property {boolean} existingFailed
 * @property {(group: object, snapshot: object) => void} onPreview
 * @property {(group: object, snapshot: object) => void} onRestore
 * @property {(fileName: string) => void} onOpen
 * @property {(groupKey: string) => void} onToggle
 */

/** Restore asks for confirmation unless the chat is known to be gone or already restored. */
export function needsConfirmation(group) {
    return group.status === GROUP_STATUS.EXISTS || group.status === GROUP_STATUS.UNKNOWN;
}

function statusText(t, group, existingFailed) {
    switch (group.status) {
        case GROUP_STATUS.RESTORED: return t`Restored: ${group.fileName}`;
        case GROUP_STATUS.EXISTS: return t`Exists: ${group.fileName}`;
        case GROUP_STATUS.DELETED: return t`Deleted`;
        default: return existingFailed ? t`Status unknown` : t`Checking…`;
    }
}

function isConfirming(options, group, snapshot) {
    return options.confirming.has(snapshot.hash) && needsConfirmation(group);
}

function confirmNote(t, group) {
    return group.status === GROUP_STATUS.EXISTS
        ? t`This chat still exists. Restoring adds a separate copy, and both copies share its memory book and chat variables. Select Confirm restore to continue.`
        : t`SillyTavern hasn't confirmed whether this chat still exists. If it does, the restored copy shares its memory book and chat variables. Select Confirm restore to continue.`;
}

function rowStatus(options, group, snapshot) {
    const { t } = options;
    if (isConfirming(options, group, snapshot)) {
        return el('p', { className: 'wbb-note', text: confirmNote(t, group) });
    }
    const row = options.rows.get(snapshot.hash);
    if (!row) return null;
    switch (row.kind) {
        case 'queued':
            return el('span', { className: 'wbb-row-status', text: t`Queued…` });
        case 'restoring':
            return el('span', { className: 'wbb-row-status', text: t`Restoring…` });
        case 'failed':
            return el('span', { className: 'wbb-row-status wbb-row-failed', text: t`Restore failed: ${row.message}` });
        case 'restored':
            if (!row.fileName) {
                return el('span', { className: 'wbb-row-status', text: t`Restored. Find it in ${options.characterName}'s chat list.` });
            }
            return el('span', { className: 'wbb-row-status wbb-row-restored' },
                el('span', { text: t`Restored as ${row.fileName}` }),
                iconButton({
                    icon: 'fa-arrow-up-right-from-square',
                    label: t`Open`,
                    className: 'wbb-open',
                    disabled: options.queueBusy,
                    title: options.queueBusy ? t`Wait until the other restores finish` : t`Open this chat`,
                    onClick: () => options.onOpen(row.fileName),
                }));
        default:
            return null;
    }
}

function snapshotRow(options, group, snapshot, latest) {
    const { t } = options;
    const { summary } = snapshot;
    const meta = [formatTime(snapshot.mtime), t`${summary.messageCount} messages`];
    if (latest) meta.push(formatSize(snapshot.size));
    const confirming = isConfirming(options, group, snapshot);
    return el('div', { className: latest ? 'wbb-snapshot wbb-snapshot-latest' : 'wbb-snapshot' },
        el('span', { className: 'wbb-snapshot-meta', text: meta.join(' · ') }),
        el('span', { className: 'wbb-actions' },
            iconButton({ icon: 'fa-eye', label: t`Preview`, className: 'wbb-preview-button', onClick: () => options.onPreview(group, snapshot) }),
            iconButton({
                icon: 'fa-rotate-left',
                label: confirming ? t`Confirm restore` : t`Restore`,
                className: 'wbb-restore-button',
                disabled: options.isQueued(snapshot.hash),
                onClick: () => options.onRestore(group, snapshot),
            })),
        latest && summary.lastMessage
            ? el('div', { className: 'wbb-excerpt', text: `${summary.lastMessage.name}: ${summary.lastMessage.excerpt}` })
            : null,
        rowStatus(options, group, snapshot));
}

/**
 * @param {ChatsViewOptions} options
 * @param {import('../grouping.js').ChatGroup} group
 * @returns {HTMLElement}
 */
export function groupSection(options, group) {
    const { t } = options;
    const [latest, ...older] = group.snapshots;
    const expanded = options.expanded.has(group.key);
    const section = el('section', { className: 'wbb-group', attrs: { 'data-status': group.status } },
        el('header', { className: 'wbb-group-header' },
            el('span', {
                className: 'wbb-group-title',
                text: group.createDate ? t`Chat started ${formatCreateDate(group.createDate)}` : t`Chat`,
            }),
            group.userName ? el('span', { className: 'wbb-group-persona', text: t`as ${group.userName}` }) : null,
            el('span', { className: `wbb-status wbb-status-${group.status}`, text: statusText(t, group, options.existingFailed) })),
        snapshotRow(options, group, latest, true));
    if (older.length > 0) {
        section.append(iconButton({
            icon: expanded ? 'fa-chevron-up' : 'fa-chevron-down',
            label: t`${older.length} older snapshots`,
            className: 'wbb-older-toggle',
            onClick: () => options.onToggle(group.key),
        }));
        if (expanded) {
            section.append(el('div', { className: 'wbb-older' },
                ...older.map((snapshot) => snapshotRow(options, group, snapshot, false))));
        }
    }
    return section;
}

/**
 * Backups that couldn't be read or aren't chat backups. Preview and Restore are disabled.
 * @param {ChatsViewOptions} options
 * @param {import('../grouping.js').Snapshot[]} problems
 * @returns {HTMLElement}
 */
export function problemSection(options, problems) {
    const { t } = options;
    return el('section', { className: 'wbb-group wbb-group-problems' },
        el('header', { className: 'wbb-group-header' }, el('span', { className: 'wbb-group-title', text: t`Unreadable` })),
        ...problems.map((snapshot) => el('div', { className: 'wbb-snapshot' },
            el('span', {
                className: 'wbb-snapshot-meta',
                text: [
                    formatTime(snapshot.mtime),
                    formatSize(snapshot.size),
                    snapshot.state === SNAPSHOT_STATE.ERROR ? t`Couldn't read this backup` : t`Not a readable chat backup`,
                ].join(' · '),
            }),
            el('span', { className: 'wbb-actions' },
                iconButton({ icon: 'fa-eye', label: t`Preview`, disabled: true, onClick: () => {} }),
                iconButton({ icon: 'fa-rotate-left', label: t`Restore`, disabled: true, onClick: () => {} })))));
}
```

- [ ] **Step 4: Write `lib/ui/previewPopup.js`**

```js
import { parseBackupMessages } from '../chatSummary.js';
import { el } from './dom.js';

/**
 * Shows every message of a backup as plain text in a second native popup. The header line,
 * which carries the chat's metadata, is never shown.
 * @param {object} deps
 * @param {object} deps.context SillyTavern.getContext()
 * @param {{fetchBackup: Function}} deps.dataMaid
 * @param {object} deps.session
 * @param {{hash: string}} deps.snapshot
 * @param {string} deps.title
 * @returns {Promise<{status: 'shown'} | {status: 'gone'}>}
 */
export async function showBackupPreview({ context, dataMaid, session, snapshot, title }) {
    const { t } = context;
    const read = await dataMaid.fetchBackup(session, snapshot.hash);
    if (read.status === 'gone') return { status: 'gone' };
    const messages = parseBackupMessages(await read.blob.text());

    const content = el('div', { className: 'wbb-preview' }, el('h3', { className: 'wbb-preview-title', text: title }));
    if (messages.length === 0) {
        content.append(el('p', { className: 'wbb-empty', text: t`This backup has no messages.` }));
    }
    for (const message of messages) {
        content.append(el('article', { className: message.isUser ? 'wbb-message wbb-message-user' : 'wbb-message' },
            el('header', { className: 'wbb-message-header' },
                el('strong', { text: message.name }),
                el('small', { text: message.sendDate })),
            el('div', { className: 'wbb-message-text', text: message.text })));
    }

    const popup = new context.Popup(content, context.POPUP_TYPE.TEXT, '', {
        large: true,
        wide: true,
        allowVerticalScrolling: true,
        okButton: t`Close`,
        onOpen: (instance) => { instance.content.scrollTop = instance.content.scrollHeight; },
    });
    await popup.show();
    return { status: 'shown' };
}
```

- [ ] **Step 5: Write `lib/ui/browserPopup.js`**

```js
import { matchBackupsToCharacters } from '../backupNames.js';
import { formatTime } from '../format.js';
import { SNAPSHOT_STATE, groupSnapshots } from '../grouping.js';
import { groupSection, needsConfirmation, problemSection } from './chatsView.js';
import { el, iconButton } from './dom.js';
import { showBackupPreview } from './previewPopup.js';

const LOG_PREFIX = '[Weyland-BackupBrowser]';

/** Key of `restoredChats`: one entry per restored chat for the page session. */
export function restoredChatKey(avatar, chatId) {
    return `${avatar}\n${chatId}`;
}

function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

/**
 * @typedef {object} BrowserDeps
 * @property {object} context SillyTavern.getContext(), taken when the popup opens.
 * @property {ReturnType<typeof import('../dataMaidClient.js').createDataMaidClient>} dataMaid
 * @property {ReturnType<typeof import('../existingChats.js').createChatsApi>} chatsApi
 * @property {ReturnType<typeof import('../summaryLoader.js').createSummaryLoader>} summaryLoader
 * @property {ReturnType<typeof import('../restore.js').createRestoreQueue>} restoreQueue
 * @property {Map<string, string>} restoredChats restoredChatKey(avatar, chatId) -> restored file name.
 * @property {(args: {session: object, character: {avatar: string, name: string}, snapshot: object}) => Promise<object>} restore
 * @property {(args: {avatar: string, fileName: string}) => Promise<boolean>} openChat
 * @property {() => Promise<void>} refreshWelcome
 */

/**
 * Opens the backup browser and resolves once it has closed.
 * @param {BrowserDeps} deps
 */
export async function openBackupBrowser(deps) {
    const { context } = deps;
    const { t } = context;

    const state = {
        session: null,
        loading: true,
        error: null,
        characters: [],
        charactersDirty: true,
        selected: null,
        snapshots: [],
        existing: null,
        existingFailed: false,
        expanded: new Set(),
        confirming: new Set(),
        rows: new Map(),
        loadController: null,
        closed: false,
        restoredAny: false,
        openedChat: false,
    };

    const root = el('div', { className: 'wbb-root', attrs: { 'data-view': 'characters' } });
    const statusBox = el('div', { className: 'wbb-status-box' });
    const characterList = el('div', { className: 'wbb-character-list' });
    const chatsHeader = el('div', { className: 'wbb-chats-header' });
    const chatsList = el('div', { className: 'wbb-chats-list' });
    const body = el('div', { className: 'wbb-body' },
        el('section', { className: 'wbb-characters-pane' },
            el('h3', { className: 'wbb-pane-title', text: t`Characters` }),
            characterList),
        el('section', { className: 'wbb-chats-pane' }, chatsHeader, chatsList));
    root.append(
        el('p', {
            className: 'wbb-notice',
            text: t`SillyTavern keeps only the latest 50 saves per character. Chatting with a character pushes its oldest backups out, so restore what you need first.`,
        }),
        statusBox,
        body);

    let renderQueued = false;
    function scheduleRender() {
        if (renderQueued || state.closed) return;
        renderQueued = true;
        requestAnimationFrame(() => {
            renderQueued = false;
            render();
        });
    }

    function render() {
        if (state.closed) return;
        const showStatus = state.loading || state.error !== null;
        statusBox.hidden = !showStatus;
        body.hidden = showStatus;
        if (state.loading) {
            statusBox.replaceChildren(el('p', { text: t`Loading backups…` }));
            return;
        }
        if (state.error !== null) {
            statusBox.replaceChildren(
                el('p', { text: t`Couldn't list the backups: ${state.error}` }),
                iconButton({ icon: 'fa-rotate-right', label: t`Retry`, onClick: () => void loadSession() }));
            return;
        }
        if (state.charactersDirty) {
            state.charactersDirty = false;
            renderCharacters();
        }
        renderChats();
    }

    function renderCharacters() {
        if (state.characters.length === 0) {
            characterList.replaceChildren(el('p', { className: 'wbb-empty', text: t`No chat backups found.` }));
            return;
        }
        characterList.replaceChildren(...state.characters.map((entry) => {
            const newest = entry.backups[0];
            const meta = newest
                ? `${t`${entry.backups.length} backups`} · ${formatTime(newest.mtime)}`
                : t`No backups left`;
            const button = el('button', {
                className: entry === state.selected ? 'wbb-character wbb-selected' : 'wbb-character',
                attrs: { type: 'button', 'data-avatar': entry.avatar },
            },
            el('img', { className: 'wbb-avatar', attrs: { src: context.getThumbnailUrl('avatar', entry.avatar), alt: '', loading: 'lazy' } }),
            el('span', { className: 'wbb-character-text' },
                el('span', { className: 'wbb-character-name', text: entry.name }),
                el('span', { className: 'wbb-character-meta', text: meta })));
            button.addEventListener('click', () => void selectCharacter(entry));
            return button;
        }));
    }

    function restoredFor(avatar) {
        const prefix = restoredChatKey(avatar, '');
        const map = new Map();
        for (const [key, fileName] of deps.restoredChats) {
            if (key.startsWith(prefix)) map.set(key.slice(prefix.length), fileName);
        }
        return map;
    }

    function renderChats() {
        const entry = state.selected;
        if (!entry) {
            chatsHeader.replaceChildren();
            chatsList.replaceChildren(el('p', { className: 'wbb-empty', text: t`Pick a character to see their backups.` }));
            return;
        }
        const { groups, problems, pending } = groupSnapshots(state.snapshots, state.existing, restoredFor(entry.avatar));
        const total = state.snapshots.length;
        chatsHeader.replaceChildren(
            iconButton({ icon: 'fa-arrow-left', label: t`Characters`, className: 'wbb-back', onClick: () => root.setAttribute('data-view', 'characters') }),
            el('h3', { className: 'wbb-chats-title', text: entry.name }),
            pending.length > 0
                ? el('span', { className: 'wbb-progress', text: t`Reading backups ${total - pending.length} / ${total}` })
                : null);

        const options = {
            t,
            characterName: entry.name,
            expanded: state.expanded,
            confirming: state.confirming,
            rows: state.rows,
            isQueued: (hash) => deps.restoreQueue.has(hash),
            queueBusy: deps.restoreQueue.isBusy(),
            existingFailed: state.existingFailed,
            onPreview: (group, snapshot) => void handlePreview(entry, snapshot),
            onRestore: (group, snapshot) => void handleRestore(entry, group, snapshot),
            onOpen: (fileName) => void handleOpen(entry, fileName),
            onToggle: (key) => {
                if (state.expanded.has(key)) state.expanded.delete(key);
                else state.expanded.add(key);
                render();
            },
        };
        const sections = groups.map((group) => groupSection(options, group));
        if (problems.length > 0) sections.push(problemSection(options, problems));
        if (sections.length === 0 && pending.length === 0) {
            sections.push(el('p', { className: 'wbb-empty', text: t`No backups left for this character.` }));
        }
        chatsList.replaceChildren(...sections);
    }

    async function loadSession() {
        try {
            state.loading = true;
            state.error = null;
            render();
            const session = await deps.dataMaid.openSession();
            if (state.closed) {
                void deps.dataMaid.closeSession(session);
                return;
            }
            state.session = session;
            state.characters = matchBackupsToCharacters(session.backups, context.characters);
            state.charactersDirty = true;
        } catch (error) {
            state.error = errorMessage(error);
        } finally {
            state.loading = false;
            render();
        }
    }

    function toSnapshot(record) {
        const summary = deps.summaryLoader.cached(record);
        if (summary === undefined) return { ...record, state: SNAPSHOT_STATE.PENDING, summary: null };
        return { ...record, state: summary ? SNAPSHOT_STATE.READY : SNAPSHOT_STATE.UNREADABLE, summary };
    }

    function dropSnapshot(entry, hash) {
        entry.backups = entry.backups.filter((backup) => backup.hash !== hash);
        if (state.selected === entry) {
            state.snapshots = state.snapshots.filter((snapshot) => snapshot.hash !== hash);
        }
        state.charactersDirty = true;
    }

    function applyResult(entry, snapshot, result) {
        if (result.status === 'gone') {
            dropSnapshot(entry, snapshot.hash);
        } else if (result.status === 'ok') {
            snapshot.state = result.summary ? SNAPSHOT_STATE.READY : SNAPSHOT_STATE.UNREADABLE;
            snapshot.summary = result.summary;
        } else {
            snapshot.state = SNAPSHOT_STATE.ERROR;
        }
        scheduleRender();
    }

    async function selectCharacter(entry) {
        state.loadController?.abort();
        const controller = new AbortController();
        state.loadController = controller;
        const { signal } = controller;

        state.selected = entry;
        state.existing = null;
        state.existingFailed = false;
        state.expanded.clear();
        state.confirming.clear();
        state.snapshots = entry.backups.map(toSnapshot);
        state.charactersDirty = true;
        root.setAttribute('data-view', 'chats');
        render();

        deps.chatsApi.listCurrentChats(entry.avatar, signal)
            .then((chats) => {
                if (signal.aborted) return;
                state.existing = chats;
                scheduleRender();
            })
            .catch((error) => {
                if (signal.aborted) return;
                console.warn(`${LOG_PREFIX} Couldn't list ${entry.name}'s current chats: ${errorMessage(error)}`);
                state.existingFailed = true;
                scheduleRender();
            });

        try {
            const pending = state.snapshots.filter((snapshot) => snapshot.state === SNAPSHOT_STATE.PENDING);
            await deps.summaryLoader.loadAll(state.session, pending, {
                signal,
                onResult: (snapshot, result) => applyResult(entry, snapshot, result),
            });
        } catch (error) {
            if (!signal.aborted) console.warn(`${LOG_PREFIX} Reading ${entry.name}'s backups stopped: ${errorMessage(error)}`);
        }
    }

    async function handlePreview(entry, snapshot) {
        try {
            const result = await showBackupPreview({
                context,
                dataMaid: deps.dataMaid,
                session: state.session,
                snapshot,
                title: `${entry.name} · ${formatTime(snapshot.mtime)}`,
            });
            if (result.status === 'gone') {
                dropSnapshot(entry, snapshot.hash);
                toastr.warning(t`SillyTavern pruned that backup after the list loaded.`);
                scheduleRender();
            }
        } catch (error) {
            toastr.error(t`Couldn't open the preview: ${errorMessage(error)}`);
        }
    }

    function reportRestore(entry, snapshot, chatId, result) {
        const { hash } = snapshot;
        if (result.status === 'restored') {
            state.restoredAny = true;
            if (result.fileName && chatId) deps.restoredChats.set(restoredChatKey(entry.avatar, chatId), result.fileName);
            state.rows.set(hash, { kind: 'restored', fileName: result.fileName });
            if (state.closed) {
                toastr.success(result.fileName
                    ? t`Restored ${entry.name}'s chat as ${result.fileName}.`
                    : t`Restored a chat for ${entry.name}. Find it in their chat list.`);
                if (!state.openedChat) void deps.refreshWelcome();
            } else if (!result.fileName) {
                toastr.info(t`Restored. Find it in ${entry.name}'s chat list.`);
            }
        } else if (result.status === 'gone') {
            state.rows.delete(hash);
            dropSnapshot(entry, hash);
            toastr.warning(t`SillyTavern pruned that backup before it could be restored.`);
        } else {
            const reason = result.status === 'unreadable' ? t`the backup couldn't be read` : result.reason;
            state.rows.set(hash, { kind: 'failed', message: reason });
            toastr.error(t`Restore failed: ${reason}`);
        }
        scheduleRender();
    }

    async function handleRestore(entry, group, snapshot) {
        const { hash } = snapshot;
        if (deps.restoreQueue.has(hash)) return;
        if (needsConfirmation(group) && !state.confirming.has(hash)) {
            state.confirming.add(hash);
            render();
            return;
        }
        state.confirming.delete(hash);
        const character = { avatar: entry.avatar, name: entry.name };
        const { chatId } = snapshot.summary;
        let result;
        try {
            state.rows.set(hash, { kind: 'queued' });
            render();
            result = await deps.restoreQueue.enqueue(hash, async () => {
                state.rows.set(hash, { kind: 'restoring' });
                scheduleRender();
                return deps.restore({ session: state.session, character, snapshot });
            });
        } catch (error) {
            result = { status: 'failed', reason: errorMessage(error) };
        }
        reportRestore(entry, snapshot, chatId, result);
    }

    async function handleOpen(entry, fileName) {
        if (deps.restoreQueue.isBusy() || state.openedChat) return;
        state.openedChat = true;
        try {
            await popup.completeAffirmative();
            const opened = await deps.openChat({ avatar: entry.avatar, fileName });
            if (!opened) {
                toastr.warning(t`SillyTavern is busy saving. Open the chat from Recent Chats in a moment.`);
                await deps.refreshWelcome();
            }
        } catch (error) {
            toastr.error(t`Couldn't open the restored chat: ${errorMessage(error)}`);
        }
    }

    const unsubscribe = deps.restoreQueue.subscribe(scheduleRender);
    const popup = new context.Popup(root, context.POPUP_TYPE.TEXT, '', {
        large: true,
        wide: true,
        okButton: t`Close`,
        allowVerticalScrolling: false,
    });
    const shown = popup.show();
    void loadSession();

    try {
        await shown;
    } finally {
        state.closed = true;
        unsubscribe();
        state.loadController?.abort();
        const { session } = state;
        if (session) {
            void deps.restoreQueue.whenIdle()
                .then(() => deps.dataMaid.closeSession(session))
                .catch(() => {});
        }
        if (state.restoredAny && !state.openedChat) await deps.refreshWelcome();
    }
}
```

- [ ] **Step 6: Write `style.css`**

```css
/* Weyland-BackupBrowser. Every selector is scoped to wbb- classes; there are no overlays of our own. */

.popup:has(.wbb-root) .popup-content {
    display: flex;
    flex-direction: column;
}

.wbb-root {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
    text-align: start;
}

.wbb-notice {
    margin: 0;
    padding: 6px 10px;
    border: 1px solid var(--SmartThemeBorderColor);
    border-radius: 6px;
    font-size: calc(var(--mainFontSize) * 0.9);
}

.wbb-status-box {
    padding: 20px;
    text-align: center;
}

.wbb-body {
    display: flex;
    flex: 1 1 auto;
    gap: 10px;
    min-height: 0;
}

.wbb-body[hidden],
.wbb-status-box[hidden] {
    display: none;
}

.wbb-characters-pane {
    display: flex;
    flex: 0 0 min(320px, 35%);
    flex-direction: column;
    min-height: 0;
    padding-right: 10px;
    border-right: 1px solid var(--SmartThemeBorderColor);
}

.wbb-chats-pane {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
}

.wbb-pane-title,
.wbb-chats-title {
    margin: 0 0 6px;
}

.wbb-character-list,
.wbb-chats-list {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
}

.wbb-character {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    margin: 0 0 4px;
    padding: 6px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
}

.wbb-character:hover {
    border-color: var(--SmartThemeBorderColor);
}

.wbb-character.wbb-selected {
    border-color: var(--SmartThemeQuoteColor);
    background-color: var(--black30a);
}

.wbb-avatar {
    flex: 0 0 auto;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    object-fit: cover;
}

.wbb-character-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.wbb-character-name {
    overflow: hidden;
    font-weight: bold;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.wbb-character-meta,
.wbb-snapshot-meta,
.wbb-progress,
.wbb-group-persona {
    font-size: calc(var(--mainFontSize) * 0.85);
    opacity: 0.8;
}

.wbb-chats-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
}

.wbb-back {
    display: none;
}

.wbb-group {
    margin: 0 0 10px;
    padding: 8px 10px;
    border: 1px solid var(--SmartThemeBorderColor);
    border-radius: 8px;
}

.wbb-group-header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px 10px;
    margin-bottom: 6px;
}

.wbb-group-title {
    font-weight: bold;
}

.wbb-status {
    padding: 1px 8px;
    border: 1px solid var(--SmartThemeBorderColor);
    border-radius: 10px;
    font-size: calc(var(--mainFontSize) * 0.8);
    overflow-wrap: anywhere;
}

.wbb-status-deleted {
    border-color: var(--warning);
}

.wbb-status-restored {
    border-color: var(--SmartThemeQuoteColor);
}

.wbb-snapshot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 10px;
    padding: 4px 0;
}

.wbb-snapshot + .wbb-snapshot {
    border-top: 1px dashed var(--SmartThemeBorderColor);
}

.wbb-snapshot-meta {
    flex: 1 1 200px;
}

.wbb-actions {
    display: flex;
    gap: 4px;
}

.wbb-excerpt {
    flex: 1 0 100%;
    font-style: italic;
    opacity: 0.85;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
}

.wbb-row-status {
    display: flex;
    flex: 1 0 100%;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    overflow-wrap: anywhere;
}

.wbb-row-failed {
    color: var(--warning);
}

.wbb-note {
    flex: 1 0 100%;
    margin: 4px 0 0;
    padding: 6px 8px;
    border-left: 3px solid var(--SmartThemeQuoteColor);
}

.wbb-older-toggle {
    margin-top: 4px;
}

.wbb-older {
    margin-left: 12px;
}

.wbb-empty {
    opacity: 0.8;
}

.wbb-preview {
    text-align: start;
}

.wbb-preview-title {
    margin: 0 0 10px;
}

.wbb-message {
    padding: 6px 0;
    border-bottom: 1px solid var(--SmartThemeBorderColor);
}

.wbb-message-header {
    display: flex;
    align-items: baseline;
    gap: 10px;
}

.wbb-message-user .wbb-message-header strong {
    color: var(--SmartThemeQuoteColor);
}

.wbb-message-text {
    overflow-wrap: anywhere;
    white-space: pre-wrap;
}

@media screen and (max-width: 1000px) {
    .wbb-characters-pane {
        flex: 1 1 auto;
        padding-right: 0;
        border-right: none;
    }

    .wbb-back {
        display: inline-flex;
    }

    /* Keyed on data-view: list every value each rule applies to. */
    .wbb-root[data-view="characters"] .wbb-chats-pane,
    .wbb-root[data-view="chats"] .wbb-characters-pane {
        display: none;
    }
}
```

- [ ] **Step 7: Run the full suite and the syntax checks**

Run:
`cd /home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-BackupBrowser && timeout 120 node --max-old-space-size=512 --test && for f in lib/ui/*.js; do node --check "$f" || exit 1; done`

Expected: PASS. The imports test loads all four UI modules, and the invariants test still passes
(no `innerHTML`, no `position: fixed`, no `console.log`, no `.variables` access). The words
"chat variables" in the confirm note are user-facing text, not property access, so the guard
doesn't match them.

- [ ] **Step 8: Self-review against the standing invariants before committing**

Grep the new files and confirm each of these by reading the matches:
- `grep -n "try\|finally\|\.add(\|\.delete(" lib/ui/browserPopup.js`. Every in-progress marker
  (`state.loading`, `state.rows.set(hash, {kind: 'queued'})`) is set inside the `try` whose
  `finally`/`catch` resolves it. The restore lock itself lives in `restoreQueue.enqueue` (Task 6).
- `grep -n "console\." lib/ui/*.js`. Only `console.warn`, with messages that are character names
  or error messages, never backup text.
- `grep -n "data-view" style.css lib/ui/*.js`. There are two values, `characters` and `chats`,
  and both CSS rules list their own value.

- [ ] **Step 9: Commit**

```bash
cd /home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-BackupBrowser && test "$(git rev-parse --show-toplevel)" = "$PWD" && git add lib/ui/dom.js lib/ui/chatsView.js lib/ui/previewPopup.js lib/ui/browserPopup.js style.css test/imports.test.js && git commit -m "Build the backup browser popup: characters, grouped chats, preview, restore and open" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Welcome button, entry point, manifest

**Controller, before dispatching this task:** tell the user that from this commit on, reloading
their SillyTavern tab loads the extension.

**Files:**
- Create: `lib/ui/welcomeButton.js`
- Create: `index.js`
- Create: `manifest.json`

**Interfaces:**
- Consumes:
  - `createDataMaidClient` (Task 4), `createChatsApi` (Task 5), `createRestoreQueue` and
    `restoreSnapshot` (Task 6), `createSummaryLoader` (Task 7), `openRestoredChat` (Task 8)
  - `openBackupBrowser` (Task 9), `iconButton` (Task 9)
- Produces:
  - `installWelcomeButton({chatElement, label, title, onClick}): {destroy(): void}`
  - `WELCOME_BUTTON_CLASS = 'wbb-welcome-button'`
  - `index.js` exports `MODULE_NAME = 'Weyland-BackupBrowser'`.

- [ ] **Step 1: Write `lib/ui/welcomeButton.js`**

```js
import { iconButton } from './dom.js';

export const WELCOME_BUTTON_CLASS = 'wbb-welcome-button';

/**
 * Keeps a Backups button in the welcome panel's shortcut row, right after Temporary Chat.
 * Core rebuilds the panel as a new direct child of #chat every time the welcome screen opens,
 * so this watches #chat's children and adds the button to any panel that lacks one.
 * @param {{chatElement: HTMLElement, label: string, title: string, onClick: () => void}} options
 * @returns {{destroy: () => void}}
 */
export function installWelcomeButton({ chatElement, label, title, onClick }) {
    function addMissingButtons() {
        for (const shortcuts of chatElement.querySelectorAll('.welcomePanel .welcomeShortcuts')) {
            if (shortcuts.querySelector(`.${WELCOME_BUTTON_CLASS}`)) continue;
            const button = iconButton({ icon: 'fa-box-open', label, title, className: WELCOME_BUTTON_CLASS, onClick });
            const temporaryChat = shortcuts.querySelector('button.openTemporaryChat');
            if (temporaryChat) temporaryChat.after(button);
            else shortcuts.append(button);
        }
    }

    const observer = new MutationObserver(addMissingButtons);
    observer.observe(chatElement, { childList: true });
    addMissingButtons();
    return { destroy: () => observer.disconnect() };
}
```

- [ ] **Step 2: Write `index.js`**

```js
// Core modules are imported by absolute URL on purpose: core's index.html sets <base href="/">,
// so these are the same module instances core loaded, wherever this extension is installed.
import { setActiveCharacter } from '/script.js';
import { openWelcomeScreen } from '/scripts/welcome-screen.js';

import { createDataMaidClient } from './lib/dataMaidClient.js';
import { createChatsApi } from './lib/existingChats.js';
import { openRestoredChat } from './lib/openChat.js';
import { createRestoreQueue, restoreSnapshot } from './lib/restore.js';
import { createSummaryLoader } from './lib/summaryLoader.js';
import { openBackupBrowser } from './lib/ui/browserPopup.js';
import { installWelcomeButton } from './lib/ui/welcomeButton.js';

export const MODULE_NAME = 'Weyland-BackupBrowser';
const LOG_PREFIX = `[${MODULE_NAME}]`;

const fetchImpl = (input, init) => fetch(input, init);
const getRequestHeaders = (options) => SillyTavern.getContext().getRequestHeaders(options);

const dataMaid = createDataMaidClient({ fetchImpl, getRequestHeaders });
const chatsApi = createChatsApi({ fetchImpl, getRequestHeaders });
const summaryLoader = createSummaryLoader({ dataMaid });
const restoreQueue = createRestoreQueue();
/** Chats restored during this page session; see restoredChatKey() in lib/ui/browserPopup.js. */
const restoredChats = new Map();

let browserOpen = false;

function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

/** Rebuilds the welcome panel so restored chats show under Recent Chats. */
async function refreshWelcome() {
    try {
        const context = SillyTavern.getContext();
        if (context.getCurrentChatId() !== undefined || context.chat.length !== 0) return;
        await openWelcomeScreen({ force: true });
    } catch (error) {
        console.warn(`${LOG_PREFIX} Couldn't refresh the welcome screen: ${errorMessage(error)}`);
    }
}

function openChat({ avatar, fileName }) {
    const context = SillyTavern.getContext();
    return openRestoredChat({
        characters: context.characters,
        avatar,
        fileName,
        listChatFiles: chatsApi.listChatFiles,
        selectCharacterById: context.selectCharacterById,
        getSelectedCharacterId: () => SillyTavern.getContext().characterId,
        setActiveCharacter,
        saveSettingsDebounced: context.saveSettingsDebounced,
        openCharacterChat: context.openCharacterChat,
    });
}

async function handleOpenBrowser() {
    if (browserOpen) return;
    try {
        browserOpen = true;
        await openBackupBrowser({
            context: SillyTavern.getContext(),
            dataMaid,
            chatsApi,
            summaryLoader,
            restoreQueue,
            restoredChats,
            restore: ({ session, character, snapshot }) => restoreSnapshot({
                dataMaid,
                chatsApi,
                session,
                character,
                snapshot,
                fetchImpl,
                getRequestHeaders,
            }),
            openChat,
            refreshWelcome,
        });
    } catch (error) {
        console.error(`${LOG_PREFIX} The backup browser failed: ${errorMessage(error)}`);
        toastr.error(errorMessage(error), MODULE_NAME);
    } finally {
        browserOpen = false;
    }
}

function init() {
    const chatElement = document.getElementById('chat');
    if (!chatElement) {
        console.warn(`${LOG_PREFIX} #chat was not found, so the Backups button can't be added.`);
        return;
    }
    const { t } = SillyTavern.getContext();
    installWelcomeButton({
        chatElement,
        label: t`Backups`,
        title: t`Browse and restore chat backups`,
        onClick: () => void handleOpenBrowser(),
    });
}

init();
```

- [ ] **Step 3: Write `manifest.json`**

```json
{
    "display_name": "Weyland-BackupBrowser",
    "loading_order": 500,
    "requires": [],
    "optional": [],
    "js": "index.js",
    "css": "style.css",
    "author": "weyland-tavern",
    "version": "1.0.0",
    "homePage": "https://github.com/aerosplat-dev/Weyland-BackupBrowser",
    "auto_update": false,
    "minimum_client_version": "1.13.3"
}
```

- [ ] **Step 4: Run the full suite and the syntax checks**

Run:
`cd /home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-BackupBrowser && timeout 120 node --max-old-space-size=512 --test && node --check index.js && node --check lib/ui/welcomeButton.js && node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"`

Expected: everything passes. `index.js` isn't imported by the tests, because it imports
`/script.js`, which only exists in the browser.

- [ ] **Step 5: Confirm SillyTavern discovers the extension**

Run:
`curl -sk -c /tmp/claude-1000/-home-adener-WeylandTavern/cd5e14d0-2f31-49c6-a102-31faf29d9009/scratchpad/wbb-jar.txt https://192.168.7.201:8000/csrf-token`

This is only a reachability check: discovery needs a logged-in session, so the controller confirms
it live in Task 11. If the server is unreachable, note that in the report instead of failing the
task.

- [ ] **Step 6: Commit**

```bash
cd /home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-BackupBrowser && test "$(git rev-parse --show-toplevel)" = "$PWD" && git add lib/ui/welcomeButton.js index.js manifest.json && git commit -m "Add the welcome-screen Backups button and the extension entry point" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: README and live verification

The README is written by an implementer. The live verification is done **by the controller**:
it needs the user's go-ahead, `WT_PASSWORD`, and judgement about the user's real data.

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

````markdown
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
  variables. Restore asks for confirmation first.
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
````

- [ ] **Step 2: Run the suite and commit**

```bash
cd /home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-BackupBrowser && timeout 120 node --max-old-space-size=512 --test && test "$(git rev-parse --show-toplevel)" = "$PWD" && git add README.md && git commit -m "Document usage, limits and safety" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 3: (Controller) Agree the run with the user**

Ask the user four things before touching the live account:
1. Keep or delete the Cerberus Sisters restore? Opening it prunes one of its backups, because
   Cerberus is at the 50-backup cap and opening a chat saves QR variables.
2. Is the user's own tab idle? The test page saves `settings.json`.
3. Is it OK to create and then delete test restores for Belle, Briar and Muse?
4. Please set `WT_PASSWORD` for the Playwright session.

- [ ] **Step 4: (Controller) Snapshot the state the run can touch**

Run:

```bash
S=/tmp/claude-1000/-home-adener-WeylandTavern/cd5e14d0-2f31-49c6-a102-31faf29d9009/scratchpad/wbb-live
D=/home/adener/WeylandTavern/SillyTavern/data/default-user
mkdir -p "$S" && cp "$D/settings.json" "$S/settings.before.json"
for c in Belle Briar Muse "Cerberus Sisters"; do ls "$D/chats/$c" > "$S/chats.before.$c.txt" 2>/dev/null; done
ls "$D/backups" > "$S/backups.before.txt"
```

- [ ] **Step 5: (Controller) Run the live checks with Playwright**

Playwright is at `/home/adener/.npm/_npx/e41f203b7505f1fb/node_modules/playwright`. Write
`$S/live.mjs` (in the scratchpad, not the repo). It should:

1. Use `chromium.launch()`, and a context with `ignoreHTTPSErrors: true`.
2. Log in: get `/csrf-token`, then `POST /api/users/login` with `X-CSRF-Token` and
   `{handle: 'default-user', password: process.env.WT_PASSWORD}` through `page.request`.
3. Go to `https://192.168.7.201:8000/`.
4. Record every `pageerror` and console error.
5. Route `**/api/chats/delete`, `**/api/data-maid/delete` and `**/api/chats/save` to
   `route.abort()` **for the parts of the run before Open is clicked**, and count any that were
   attempted. The extension must never call them.

Then verify, in order, with a screenshot at each numbered point:

1. **Button.** `.welcomePanel .welcomeShortcuts .wbb-welcome-button` exists, and it is the next
   sibling of `button.openTemporaryChat`.
2. **Character list.** Clicking it shows `.wbb-root`, and `.wbb-character` count equals the
   number of characters with backups (23 on 2026-09-23). The chats list and the character list
   each scroll inside the popup; check that `scrollHeight > clientHeight` on `.wbb-chats-list`
   once Cerberus is open.
3. **Cerberus Sisters.**
   - When `.wbb-progress` disappears, there is exactly one `.wbb-group`, with
     `data-status="deleted"`, and a toggle reading "49 older snapshots".
   - Expanding it shows 49 rows.
   - Preview the latest: `.wbb-message` count equals the summary's message count, and the
     preview's text contains none of the first 60 characters of the backup header's `ravteg`
     value. Read that value in Node from the newest `chat_cerberus_sisters_*.jsonl`, and don't
     print it.
   - The preview opens scrolled to the bottom.
4. **Belle** (3 groups).
   - Statuses are one `exists` and two `deleted`.
   - The first Restore click on the Exists group shows `.wbb-note` and the label **Confirm
     restore**. The second click shows **Restored as …**.
   - On disk, `chats/Belle` has exactly one new file, and `cmp` says it is byte-identical to the
     backup.
   - Close the popup with **Close**: the restored Belle chat is now listed in `.recentChat`.
5. **Briar** (stale pointer, 9 backups).
   - Restore the latest, then **Open**. The current chat id
     (`SillyTavern.getContext().getCurrentChatId()`) equals the restored name.
   - `chats/Briar` contains only the restored file: no greeting-only file named after the old
     pointer.
6. **Rebuild.**
   - Close the chat (`#option_close_chat`). The welcome panel comes back with exactly one
     `.wbb-welcome-button`.
7. **Muse** (valid pointer, 2 backups).
   - Restore, then **Open**. The current chat id equals the restored name.
   - `chats/Muse` holds the original plus the restored file, and nothing else.
8. **Mobile.**
   - A new context at 390×844 opens the popup with the character list only visible.
   - Tapping a character shows the chats pane and `.wbb-back`, and back returns to the list.
9. **Cerberus Sisters, only if the user said keep.**
   - Restore the latest, then **Open**, and confirm no stray file appeared.
10. **Errors.** No page errors or console errors from the extension, and zero blocked calls.

- [ ] **Step 6: (Controller) Clean up and report**

1. **Muse:** open its original chat again, so the card's pointer goes back to it: in the live page
   call `openCharacterChat('<original name>')` with Muse selected.
2. **Delete each test restore** (Belle, Briar, Muse, and Cerberus unless kept).
   - Use `POST /api/chats/delete` with `{avatar_url, chatfile}` through curl, and a
     CSRF-authenticated cookie jar.
   - Take the file names from the diff against the `chats.before.*` listings. Never delete a file
     that was in the listing before the run.
3. **Diff `settings.json`** against `settings.before.json`, and the backups listing against
   `backups.before.txt`. Report every difference to the user, including backups created or pruned
   by the chat opens. Don't "fix" SillyTavern's own backup files.
4. **Report** what passed and what failed, with screenshots, and fix any real defect through a
   normal task-and-review cycle before declaring done.

- [ ] **Step 7: (Controller) Final whole-branch review**

Dispatch a fresh reviewer over the whole repo (`git log`, all of `lib/`, `index.js`,
`style.css`, tests), told explicitly not to trust earlier reports. The reviewer re-verifies each
Global Constraint by reading code:
- the header privacy rule
- the lock placement
- the only core-state write
- no forbidden endpoints
- `data-view` coverage in CSS
- the absolute core imports

Fix whatever it confirms, then ask the user whether to push to `origin`.
