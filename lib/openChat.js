/**
 * Opens a restored chat the way core's recent-chat opener does (openRecentCharacterChat in
 * public/scripts/welcome-screen.js), without first reloading a chat that no longer exists.
 * @param {object} deps
 * @param {Array<{avatar: string, chat: string}>} deps.characters Core's live characters array.
 * @param {string} deps.avatar
 * @param {string} deps.fileName The restored file, including ".jsonl".
 * @param {(avatar: string) => Promise<string[]>} deps.listChatFiles
 * @param {(id: number) => Promise<void>} deps.selectCharacterById
 * @param {() => (string|number|undefined)} deps.getSelectedCharacterId
 * @param {(avatar: string) => void} deps.setActiveCharacter
 * @param {() => void} deps.saveSettingsDebounced
 * @param {(chatName: string) => Promise<void>} deps.openCharacterChat
 * @returns {Promise<boolean>} false when core refused to switch characters.
 */
export async function openRestoredChat({
    characters,
    avatar,
    fileName,
    listChatFiles,
    selectCharacterById,
    getSelectedCharacterId,
    setActiveCharacter,
    saveSettingsDebounced,
    openCharacterChat,
}) {
    const characterId = characters.findIndex((character) => character?.avatar === avatar);
    if (characterId === -1) throw new Error(`Character not found: ${avatar}`);
    const chatName = fileName.replace(/\.jsonl$/, '');

    const files = await listChatFiles(avatar);
    if (!files.includes(`${characters[characterId].chat}.jsonl`)) {
        // The same assignment core's openCharacterChat makes first. Without it, selecting the
        // character would load its missing last chat, and core would recreate that chat as a
        // greeting-only file (a save that also prunes one of the character's backups).
        characters[characterId].chat = chatName;
    }

    await selectCharacterById(characterId);
    if (String(getSelectedCharacterId()) !== String(characterId)) return false;
    setActiveCharacter(avatar);
    saveSettingsDebounced();
    await openCharacterChat(chatName);
    return true;
}
