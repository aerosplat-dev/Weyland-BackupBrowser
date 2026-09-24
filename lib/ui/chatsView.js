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
 * @property {Map<string, number>} confirming Snapshot hashes waiting for a second Restore click, to when they were armed.
 * @property {Map<string, RowState>} rows Restore state per snapshot hash.
 * @property {(hash: string) => boolean} isQueued
 * @property {boolean} queueBusy
 * @property {boolean} existingFailed
 * @property {(group: object, snapshot: object) => void} onPreview
 * @property {(group: object, snapshot: object) => void} onRestore
 * @property {(fileName: string) => void} onOpen
 * @property {(groupKey: string) => void} onToggle
 */

/**
 * Restore asks for confirmation unless the chat is known to be gone and nothing was restored from
 * it, or is being restored, yet.
 */
export function needsConfirmation(group, rows) {
    if (group.status !== GROUP_STATUS.DELETED) return true;
    return group.snapshots.some((snapshot) => {
        const kind = rows.get(snapshot.hash)?.kind;
        return kind === 'restored' || kind === 'queued' || kind === 'restoring';
    });
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
    return options.confirming.has(snapshot.hash) && needsConfirmation(group, options.rows);
}

function confirmNote(t, group, rows) {
    const alreadyRestored = group.status === GROUP_STATUS.RESTORED
        || group.snapshots.some((snapshot) => rows.get(snapshot.hash)?.kind === 'restored');
    if (alreadyRestored) {
        return t`You already restored this chat. Restoring it again adds another copy, and all copies share its memory book and chat variables. Select Confirm restore to continue.`;
    }
    const siblingInFlight = group.snapshots.some((snapshot) => {
        const kind = rows.get(snapshot.hash)?.kind;
        return kind === 'queued' || kind === 'restoring';
    });
    if (siblingInFlight) {
        return t`A restore of this chat is already in progress. Restoring again adds another copy, and all copies share its memory book and chat variables. Select Confirm restore to continue.`;
    }
    return group.status === GROUP_STATUS.EXISTS
        ? t`This chat still exists. Restoring adds a separate copy, and both copies share its memory book and chat variables. Select Confirm restore to continue.`
        : t`SillyTavern hasn't confirmed whether this chat still exists. If it does, the restored copy shares its memory book and chat variables. Select Confirm restore to continue.`;
}

function rowStatus(options, group, snapshot) {
    const { t } = options;
    if (isConfirming(options, group, snapshot)) {
        return el('p', { className: 'wbb-note', text: confirmNote(t, group, options.rows) });
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
