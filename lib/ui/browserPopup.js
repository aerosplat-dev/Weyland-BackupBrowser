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
