// Core modules are imported by absolute URL on purpose: core's index.html sets <base href="/">,
// so these are the same module instances core loaded, wherever this extension is installed.
import { setActiveCharacter } from '/script.js';
import { openWelcomeScreen } from '/scripts/welcome-screen.js';

import { createDataMaidClient } from './lib/dataMaidClient.js';
import { createChatsApi } from './lib/existingChats.js';
import { openRestoredChat } from './lib/openChat.js';
import { createRestoreQueue, restoreSnapshot } from './lib/restore.js';
import { createSummaryLoader } from './lib/summaryLoader.js';
import { openBackupBrowser } from './lib/ui/browserPopup.js';
import { installWelcomeButton } from './lib/ui/welcomeButton.js';

export const MODULE_NAME = 'Weyland-BackupBrowser';
const LOG_PREFIX = `[${MODULE_NAME}]`;

const fetchImpl = (input, init) => fetch(input, init);
const getRequestHeaders = (options) => SillyTavern.getContext().getRequestHeaders(options);

const dataMaid = createDataMaidClient({ fetchImpl, getRequestHeaders });
const chatsApi = createChatsApi({ fetchImpl, getRequestHeaders });
const summaryLoader = createSummaryLoader({ dataMaid });
const restoreQueue = createRestoreQueue();
/** Chats restored during this page session; see restoredChatKey() in lib/ui/browserPopup.js. */
const restoredChats = new Map();

let browserOpen = false;

function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

/** Rebuilds the welcome panel so restored chats show under Recent Chats. */
async function refreshWelcome() {
    try {
        const context = SillyTavern.getContext();
        if (context.getCurrentChatId() !== undefined || context.chat.length !== 0) return;
        await openWelcomeScreen({ force: true });
    } catch (error) {
        console.warn(`${LOG_PREFIX} Couldn't refresh the welcome screen: ${errorMessage(error)}`);
    }
}

function openChat({ avatar, fileName }) {
    const context = SillyTavern.getContext();
    return openRestoredChat({
        characters: context.characters,
        avatar,
        fileName,
        listChatFiles: chatsApi.listChatFiles,
        selectCharacterById: context.selectCharacterById,
        getSelectedCharacterId: () => SillyTavern.getContext().characterId,
        setActiveCharacter,
        saveSettingsDebounced: context.saveSettingsDebounced,
        openCharacterChat: context.openCharacterChat,
    });
}

async function handleOpenBrowser() {
    if (browserOpen) return;
    try {
        browserOpen = true;
        await openBackupBrowser({
            context: SillyTavern.getContext(),
            dataMaid,
            chatsApi,
            summaryLoader,
            restoreQueue,
            restoredChats,
            restore: ({ session, character, snapshot }) => restoreSnapshot({
                dataMaid,
                chatsApi,
                session,
                character,
                snapshot,
                fetchImpl,
                getRequestHeaders,
            }),
            openChat,
            refreshWelcome,
        });
    } catch (error) {
        console.error(`${LOG_PREFIX} The backup browser failed: ${errorMessage(error)}`);
        toastr.error(errorMessage(error), MODULE_NAME);
    } finally {
        browserOpen = false;
    }
}

function init() {
    const chatElement = document.getElementById('chat');
    if (!chatElement) {
        console.warn(`${LOG_PREFIX} #chat was not found, so the Backups button can't be added.`);
        return;
    }
    const { t } = SillyTavern.getContext();
    installWelcomeButton({
        chatElement,
        label: t`Backups`,
        title: t`Browse and restore chat backups`,
        onClick: () => void handleOpenBrowser(),
    });
}

init();
