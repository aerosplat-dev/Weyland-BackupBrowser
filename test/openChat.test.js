import test from 'node:test';
import assert from 'node:assert/strict';

import { openRestoredChat } from '../lib/openChat.js';

const RESTORED = 'Briar - 2026-9-23 @16h 15m 57s 608ms imported.jsonl';
const RESTORED_NAME = 'Briar - 2026-9-23 @16h 15m 57s 608ms imported';

function setup({ pointer, files, selectWorks = true }) {
    const calls = [];
    const characters = [{ avatar: 'Other.png', chat: 'x' }, { avatar: 'Briar.png', chat: pointer }];
    let selected;
    const deps = {
        characters,
        avatar: 'Briar.png',
        fileName: RESTORED,
        listChatFiles: async (avatar) => { calls.push(['list', avatar]); return files; },
        selectCharacterById: async (id) => {
            calls.push(['select', id, characters[id].chat]);
            if (selectWorks) selected = id;
        },
        getSelectedCharacterId: () => (selected === undefined ? undefined : String(selected)),
        setActiveCharacter: (avatar) => { calls.push(['setActive', avatar]); },
        saveSettingsDebounced: () => { calls.push(['saveSettings']); },
        openCharacterChat: async (name) => { calls.push(['open', name]); },
    };
    return { calls, characters, deps };
}

test('a missing chat pointer is moved to the restored chat before selecting', async () => {
    const { calls, deps } = setup({ pointer: 'Briar - deleted', files: [RESTORED] });
    assert.equal(await openRestoredChat(deps), true);
    assert.deepEqual(calls, [
        ['list', 'Briar.png'],
        ['select', 1, RESTORED_NAME],
        ['setActive', 'Briar.png'],
        ['saveSettings'],
        ['open', RESTORED_NAME],
    ]);
});

test('a valid chat pointer is left alone and core switches chats itself', async () => {
    const { calls, characters, deps } = setup({ pointer: 'Briar - current', files: ['Briar - current.jsonl', RESTORED] });
    assert.equal(await openRestoredChat(deps), true);
    assert.deepEqual(calls[1], ['select', 1, 'Briar - current']);
    assert.deepEqual(calls.at(-1), ['open', RESTORED_NAME]);
    assert.equal(characters[1].chat, 'Briar - current');
});

test('stops when core refuses to switch characters', async () => {
    const { calls, deps } = setup({ pointer: 'Briar - current', files: ['Briar - current.jsonl'], selectWorks: false });
    assert.equal(await openRestoredChat(deps), false);
    assert.deepEqual(calls.map((call) => call[0]), ['list', 'select']);
});

test('rejects an unknown avatar', async () => {
    const { deps } = setup({ pointer: 'x', files: [] });
    await assert.rejects(openRestoredChat({ ...deps, avatar: 'Nobody.png' }), /Nobody\.png/);
});
