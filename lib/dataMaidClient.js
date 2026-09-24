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
