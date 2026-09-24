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
