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
