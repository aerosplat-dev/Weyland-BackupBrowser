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
