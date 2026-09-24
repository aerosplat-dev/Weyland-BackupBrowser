import { iconButton } from './dom.js';

export const WELCOME_BUTTON_CLASS = 'wbb-welcome-button';

/**
 * Keeps a Backups button in the welcome panel's shortcut row, right after Temporary Chat.
 * Core rebuilds the panel as a new direct child of #chat every time the welcome screen opens,
 * so this watches #chat's children and adds the button to any panel that lacks one.
 * @param {{chatElement: HTMLElement, label: string, title: string, onClick: () => void}} options
 * @returns {{destroy: () => void}}
 */
export function installWelcomeButton({ chatElement, label, title, onClick }) {
    function addMissingButtons() {
        for (const shortcuts of chatElement.querySelectorAll('.welcomePanel .welcomeShortcuts')) {
            if (shortcuts.querySelector(`.${WELCOME_BUTTON_CLASS}`)) continue;
            const button = iconButton({ icon: 'fa-box-open', label, title, className: WELCOME_BUTTON_CLASS, onClick });
            const temporaryChat = shortcuts.querySelector('button.openTemporaryChat');
            if (temporaryChat) temporaryChat.after(button);
            else shortcuts.append(button);
        }
    }

    const observer = new MutationObserver(addMissingButtons);
    observer.observe(chatElement, { childList: true });
    addMissingButtons();
    return { destroy: () => observer.disconnect() };
}
