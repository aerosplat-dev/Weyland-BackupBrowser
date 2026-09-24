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
