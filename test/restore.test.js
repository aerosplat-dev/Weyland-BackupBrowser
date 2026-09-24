import test from 'node:test';
import assert from 'node:assert/strict';

import { buildImportForm, createRestoreQueue, restoreSnapshot } from '../lib/restore.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('queue runs jobs one at a time, in order', async () => {
    const queue = createRestoreQueue();
    const order = [];
    const gate = deferred();
    const first = queue.enqueue('a', async () => { order.push('a:start'); await gate.promise; order.push('a:end'); return 'A'; });
    const second = queue.enqueue('b', async () => { order.push('b:start'); return 'B'; });
    await tick();
    assert.deepEqual(order, ['a:start']);
    assert.equal(queue.has('b'), true);
    gate.resolve();
    assert.deepEqual(await Promise.all([first, second]), ['A', 'B']);
    assert.deepEqual(order, ['a:start', 'a:end', 'b:start']);
    assert.equal(queue.isBusy(), false);
});

test('queue tracking, notifications and whenIdle', async () => {
    const queue = createRestoreQueue();
    let notifications = 0;
    const unsubscribe = queue.subscribe(() => { notifications += 1; });
    const gate = deferred();
    const job = queue.enqueue('a', () => gate.promise);
    assert.equal(queue.has('a'), true);
    assert.equal(queue.isBusy(), true);
    let idle = false;
    const idlePromise = queue.whenIdle().then(() => { idle = true; });
    await tick();
    assert.equal(idle, false);
    gate.resolve('done');
    assert.equal(await job, 'done');
    await idlePromise;
    assert.equal(idle, true);
    assert.equal(queue.has('a'), false);
    assert.equal(notifications, 2);
    unsubscribe();
    await queue.enqueue('b', async () => {});
    assert.equal(notifications, 2);
});

test('a failing job rejects, releases its id and lets the next job run', async () => {
    const queue = createRestoreQueue();
    const failing = queue.enqueue('a', async () => { throw new Error('boom'); });
    const next = queue.enqueue('b', async () => 'ok');
    await assert.rejects(failing, /boom/);
    assert.equal(await next, 'ok');
    assert.equal(queue.has('a'), false);
    assert.equal(queue.isBusy(), false);
});

test('a throwing listener does not break the queue', async () => {
    const queue = createRestoreQueue();
    queue.subscribe(() => { throw new Error('listener'); });
    assert.equal(await queue.enqueue('a', async () => 1), 1);
    assert.equal(queue.isBusy(), false);
});

test('buildImportForm sends the backup bytes the way core import expects', async () => {
    const blob = new Blob(['{"user_name":"Rob"}\n{"mes":"é"}']);
    const form = buildImportForm({
        blob,
        backupName: 'chat_bap_20260908-105331.jsonl',
        avatar: 'Bap.png',
        characterName: 'A/B: C',
        userName: 'Rob',
    });
    const file = form.get('avatar');
    assert.ok(file instanceof File);
    assert.equal(file.name, 'chat_bap_20260908-105331.jsonl');
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), new Uint8Array(await blob.arrayBuffer()));
    assert.equal(form.get('file_type'), 'jsonl');
    assert.equal(form.get('avatar_url'), 'Bap.png');
    assert.equal(form.get('character_name'), 'AB C');
    assert.equal(form.get('user_name'), 'Rob');
    assert.equal(buildImportForm({ blob, backupName: 'x', avatar: 'y', characterName: '///', userName: '' }).get('character_name'), 'Restored chat');
});

const VALID = [
    JSON.stringify({ user_name: 'Rob', character_name: 'Bap', create_date: 'c', chat_metadata: { integrity: 'u' } }),
    JSON.stringify({ name: 'Bap', mes: 'hi' }),
].join('\n');

function setup({
    read = { status: 'ok', blob: new Blob([VALID]) },
    before = ['Bap - 1.jsonl'],
    after = ['Bap - 1.jsonl', 'Bap - 2 imported.jsonl'],
    importResponse = () => jsonResponse({ res: true }),
} = {}) {
    const calls = [];
    let listCount = 0;
    const deps = {
        dataMaid: {
            fetchBackup: async (session, hash) => { calls.push(['fetchBackup', hash]); return read; },
        },
        chatsApi: {
            listChatFiles: async (avatar) => {
                calls.push(['listChatFiles', avatar]);
                listCount += 1;
                if (listCount === 1) return before;
                if (after instanceof Error) throw after;
                return after;
            },
            ensureChatFolder: async (avatar) => { calls.push(['ensureChatFolder', avatar]); },
        },
        session: { token: 't' },
        character: { avatar: 'Bap.png', name: 'Bap' },
        snapshot: { name: 'chat_bap_20260908-105331.jsonl', hash: 'h1' },
        fetchImpl: async (url, init) => { calls.push(['fetch', url, init]); return importResponse(); },
        getRequestHeaders: (options) => { calls.push(['headers', options]); return { 'X-CSRF-Token': 'csrf' }; },
    };
    return { calls, deps };
}

test('restoreSnapshot reads, checks the folder, imports, and finds the new file', async () => {
    const { calls, deps } = setup();
    assert.deepEqual(await restoreSnapshot(deps), { status: 'restored', fileName: 'Bap - 2 imported.jsonl' });
    assert.deepEqual(calls.map((call) => call[0]), ['fetchBackup', 'listChatFiles', 'ensureChatFolder', 'headers', 'fetch', 'listChatFiles']);
    assert.deepEqual(calls[3][1], { omitContentType: true });
    const [, url, init] = calls[4];
    assert.equal(url, '/api/chats/import');
    assert.equal(init.method, 'POST');
    assert.deepEqual(init.headers, { 'X-CSRF-Token': 'csrf' });
    assert.ok(init.body instanceof FormData);
    assert.equal(init.body.get('user_name'), 'Rob');
    assert.equal(init.body.get('avatar_url'), 'Bap.png');
    assert.equal(await init.body.get('avatar').text(), VALID);
});

test('restoreSnapshot leaves the file name unknown unless exactly one file appeared', async () => {
    assert.deepEqual(await restoreSnapshot(setup({ after: ['Bap - 1.jsonl'] }).deps), { status: 'restored', fileName: null });
    assert.deepEqual(
        await restoreSnapshot(setup({ after: ['Bap - 1.jsonl', 'Bap - 2.jsonl', 'Bap - 3.jsonl'] }).deps),
        { status: 'restored', fileName: null },
    );
    assert.deepEqual(await restoreSnapshot(setup({ after: new Error('list failed') }).deps), { status: 'restored', fileName: null });
});

test('restoreSnapshot reports rejected and failed imports', async () => {
    assert.deepEqual(
        await restoreSnapshot(setup({ importResponse: () => jsonResponse({ error: true }) }).deps),
        { status: 'failed', reason: 'The import was rejected' },
    );
    assert.deepEqual(
        await restoreSnapshot(setup({ importResponse: () => new Response('', { status: 500 }) }).deps),
        { status: 'failed', reason: 'HTTP 500' },
    );
});

test('restoreSnapshot never imports a pruned or unreadable backup', async () => {
    const gone = setup({ read: { status: 'gone' } });
    assert.deepEqual(await restoreSnapshot(gone.deps), { status: 'gone' });
    assert.ok(!gone.calls.some((call) => call[0] === 'fetch'));

    const unreadable = setup({ read: { status: 'ok', blob: new Blob(['not json']) } });
    assert.deepEqual(await restoreSnapshot(unreadable.deps), { status: 'unreadable' });
    assert.ok(!unreadable.calls.some((call) => call[0] === 'fetch'));
});
