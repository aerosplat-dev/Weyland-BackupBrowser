import { parseBackupMessages } from '../chatSummary.js';
import { el } from './dom.js';

/**
 * Shows every message of a backup as plain text in a second native popup. The header line,
 * which carries the chat's metadata, is never shown.
 * @param {object} deps
 * @param {object} deps.context SillyTavern.getContext()
 * @param {{fetchBackup: Function}} deps.dataMaid
 * @param {object} deps.session
 * @param {{hash: string}} deps.snapshot
 * @param {string} deps.title
 * @returns {Promise<{status: 'shown'} | {status: 'gone'}>}
 */
export async function showBackupPreview({ context, dataMaid, session, snapshot, title }) {
    const { t } = context;
    const read = await dataMaid.fetchBackup(session, snapshot.hash);
    if (read.status === 'gone') return { status: 'gone' };
    const messages = parseBackupMessages(await read.blob.text());

    const content = el('div', { className: 'wbb-preview' }, el('h3', { className: 'wbb-preview-title', text: title }));
    if (messages.length === 0) {
        content.append(el('p', { className: 'wbb-empty', text: t`This backup has no messages.` }));
    }
    for (const message of messages) {
        content.append(el('article', { className: message.isUser ? 'wbb-message wbb-message-user' : 'wbb-message' },
            el('header', { className: 'wbb-message-header' },
                el('strong', { text: message.name }),
                el('small', { text: message.sendDate })),
            el('div', { className: 'wbb-message-text', text: message.text })));
    }

    const popup = new context.Popup(content, context.POPUP_TYPE.TEXT, '', {
        large: true,
        wide: true,
        allowVerticalScrolling: true,
        okButton: t`Close`,
        onOpen: (instance) => { instance.content.scrollTop = instance.content.scrollHeight; },
    });
    await popup.show();
    return { status: 'shown' };
}
