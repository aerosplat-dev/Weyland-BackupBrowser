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
