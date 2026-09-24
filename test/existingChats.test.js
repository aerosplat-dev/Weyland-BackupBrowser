import test from 'node:test';
import assert from 'node:assert/strict';

import { createChatsApi } from '../lib/existingChats.js';

const headers = () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf' });
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status });

function fakeFetch(route) {
    const calls = [];
    const fetchImpl = async (url, init) => {
        const body = JSON.parse(init.body);
        calls.push({ url, body, init });
        return route(url, body);
    };
    return { calls, fetchImpl };
}

test('listChatFiles asks for the simple list and keeps .jsonl names', async () => {
    const server = fakeFetch(() => jsonResponse([
        { file_name: 'Bap - 1.jsonl' },
        { file_name: 'notes.txt' },
        { nope: true },
    ]));
    const api = createChatsApi({ fetchImpl: server.fetchImpl, getRequestHeaders: headers });
    assert.deepEqual(await api.listChatFiles('Bap.png'), ['Bap - 1.jsonl']);
    assert.equal(server.calls[0].url, '/api/characters/chats');
    assert.deepEqual(server.calls[0].body, { avatar_url: 'Bap.png', simple: true });
    assert.equal(server.calls[0].init.method, 'POST');
    assert.deepEqual(server.calls[0].init.headers, headers());
});

test('listChatFiles treats {error: true} as no chats and throws on HTTP errors', async () => {
    const none = createChatsApi({ fetchImpl: fakeFetch(() => jsonResponse({ error: true })).fetchImpl, getRequestHeaders: headers });
    assert.deepEqual(await none.listChatFiles('Bap.png'), []);
    const broken = createChatsApi({ fetchImpl: fakeFetch(() => new Response('', { status: 500 })).fetchImpl, getRequestHeaders: headers });
    await assert.rejects(broken.listChatFiles('Bap.png'));
});

test('listCurrentChats reads each chat header for its id', async () => {
    const server = fakeFetch((url, body) => {
        if (url === '/api/characters/chats') return jsonResponse([{ file_name: 'Bap - 1.jsonl' }, { file_name: 'Bap - 2.jsonl' }]);
        if (body.file_name === 'Bap - 1') return jsonResponse([{ create_date: 'c1', chat_metadata: { integrity: 'u1' } }, { mes: 'hi' }]);
        return jsonResponse({});
    });
    const api = createChatsApi({ fetchImpl: server.fetchImpl, getRequestHeaders: headers });
    assert.deepEqual(await api.listCurrentChats('Bap.png'), [
        { fileName: 'Bap - 1.jsonl', chatId: 'integrity:u1' },
        { fileName: 'Bap - 2.jsonl', chatId: null },
    ]);
    assert.deepEqual(server.calls[1].body, { avatar_url: 'Bap.png', file_name: 'Bap - 1' });
    assert.equal(server.calls[1].url, '/api/chats/get');
});

test('listCurrentChats never reads headers when there are no chats', async () => {
    const server = fakeFetch(() => jsonResponse({ error: true }));
    const api = createChatsApi({ fetchImpl: server.fetchImpl, getRequestHeaders: headers });
    assert.deepEqual(await api.listCurrentChats('Bap.png'), []);
    assert.equal(server.calls.length, 1);
});

test('ensureChatFolder calls chats/get without a file name', async () => {
    const server = fakeFetch(() => jsonResponse({}));
    const api = createChatsApi({ fetchImpl: server.fetchImpl, getRequestHeaders: headers });
    await api.ensureChatFolder('Bap.png');
    assert.equal(server.calls[0].url, '/api/chats/get');
    assert.deepEqual(server.calls[0].body, { avatar_url: 'Bap.png' });

    const broken = createChatsApi({ fetchImpl: fakeFetch(() => new Response('', { status: 400 })).fetchImpl, getRequestHeaders: headers });
    await assert.rejects(broken.ensureChatFolder('Bap.png'));
});
