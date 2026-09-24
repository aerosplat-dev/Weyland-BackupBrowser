/**
 * One Data Maid session for the whole page. Every popup, and every restore that outlives a popup,
 * uses the same session object. A new report (which replaces the user's single token) updates that
 * object's token in place, so queued work follows it instead of holding a dead token.
 * @param {object} deps
 * @param {{openSession: Function, closeSession: Function}} deps.dataMaid
 * @param {{whenIdle: () => Promise<void>}} deps.restoreQueue
 * @param {() => boolean} deps.isBrowserOpen
 */
export function createSessionManager({ dataMaid, restoreQueue, isBrowserOpen }) {
    let current = null;

    /** Re-runs the report and returns the shared session, updated in place. */
    async function acquire(signal) {
        const fresh = await dataMaid.openSession(signal);
        if (current) {
            current.token = fresh.token;
            current.backups = fresh.backups;
            return current;
        }
        current = fresh;
        return current;
    }

    /** Finalizes the shared session once nothing needs it: no restore queued or running, no popup open. */
    async function release() {
        await restoreQueue.whenIdle();
        if (isBrowserOpen() || !current) return;
        const session = current;
        current = null;
        await dataMaid.closeSession(session);
    }

    return { acquire, release };
}
