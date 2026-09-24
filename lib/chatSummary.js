/**
 * Reads backup text. The header line carries the chat's whole metadata; only user_name
 * (or its legacy alias, the top-level name), character_name, create_date and the integrity
 * id ever leave this module.
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
