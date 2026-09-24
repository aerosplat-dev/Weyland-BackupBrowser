import test from 'node:test';
import assert from 'node:assert/strict';

import { DataMaidError, createDataMaidClient } from '../lib/dataMaidClient.js';

const headers = () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf' });
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
});

const REPORT = {
    images: [{ name: 'img.png', hash: 'i', size: 1, mtime: 1 }],
    chatBackups: [
        { name: 'chat_bap_20260908-105331.jsonl', hash: 'h1', size: 5, mtime: 100, parent: 'x' },
        { name: 42, hash: 'bad', size: 1, mtime: 1 },
    ],
    settingsBackups: [{ name: 'settings_default-user_1.json', hash: 's', size: 1, mtime: 1 }],
};

/**
 * @param {object} options
 * @param {string[]} options.tokens Tokens handed out by successive reports.
 * @param {(hash: string, token: string) => Response} [options.view]
 */
function fakeServer({ tokens, view = () => new Response('hello') }) {
    const calls = [];
    let reportCount = 0;
    const fetchImpl = async (url, init = {}) => {
        calls.push({ url, init });
        await Promise.resolve();
        if (url === '/api/data-maid/report') {
            const token = tokens[reportCount];
            reportCount += 1;
            return jsonResponse({ report: REPORT, token });
        }
        if (url.startsWith('/api/data-maid/view?')) {
            const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
            return view(params.get('hash'), params.get('token'));
        }
        if (url === '/api/data-maid/finalize') return new Response(null, { status: 204 });
        throw new Error(`unexpected request ${url}`);
    };
    return { calls, fetchImpl, reports: () => reportCount };
}

test('openSession keeps only valid chat backups and the token', async () => {
    const server = fakeServer({ tokens: ['t1'] });
    const client = createDataMaidClient({ fetchImpl: server.fetchImpl, getRequestHeaders: headers });
    const session = await client.openSession();
    assert.equal(session.token, 't1');
    assert.deepEqual(session.backups, [{ name: 'chat_bap_20260908-105331.jsonl', hash: 'h1', size: 5, mtime: 100 }]);
    assert.equal(server.calls[0].init.method, 'POST');
    assert.deepEqual(server.calls[0].init.headers, headers());
});

test('openSession rejects on an HTTP error or a missing token', async () => {
    const failing = createDataMaidClient({
        fetchImpl: async () => new Response('', { status: 500 }),
        getRequestHeaders: headers,
    });
    await assert.rejects(failing.openSession(), (error) => error instanceof DataMaidError && error.status === 500);

    const tokenless = createDataMaidClient({
        fetchImpl: async () => jsonResponse({ report: REPORT }),
        getRequestHeaders: headers,
    });
    await assert.rejects(tokenless.openSession(), DataMaidError);
});

test('fetchBackup returns the file as a blob and passes the signal', async () => {
    const server = fakeServer({ tokens: ['t 1'] });
    const client = createDataMaidClient({ fetchImpl: server.fetchImpl, getRequestHeaders: headers });
    const session = await client.openSession();
    const signal = new AbortController().signal;
    const result = await client.fetchBackup(session, 'h/1', signal);
    assert.equal(result.status, 'ok');
    assert.equal(await result.blob.text(), 'hello');
    const viewCall = server.calls[1];
    assert.equal(viewCall.url, '/api/data-maid/view?hash=h%2F1&token=t%201');
    assert.equal(viewCall.init.signal, signal);
});

test('fetchBackup reports a pruned backup as gone', async () => {
    const server = fakeServer({ tokens: ['t1'], view: () => new Response('', { status: 404 }) });
    const client = createDataMaidClient({ fetchImpl: server.fetchImpl, getRequestHeaders: headers });
    const session = await client.openSession();
    assert.deepEqual(await client.fetchBackup(session, 'h1'), { status: 'gone' });
});

test('a 403 re-reports once and retries with the new token', async () => {
    const server = fakeServer({
        tokens: ['t1', 't2'],
        view: (hash, token) => (token === 't2' ? new Response('fresh') : new Response('', { status: 403 })),
    });
    const client = createDataMaidClient({ fetchImpl: server.fetchImpl, getRequestHeaders: headers });
    const session = await client.openSession();
    const result = await client.fetchBackup(session, 'h1');
    assert.equal(await result.blob.text(), 'fresh');
    assert.equal(session.token, 't2');
    assert.equal(server.reports(), 2);
});

test('a second 403 fails with DataMaidError', async () => {
    const server = fakeServer({ tokens: ['t1', 't2'], view: () => new Response('', { status: 403 }) });
    const client = createDataMaidClient({ fetchImpl: server.fetchImpl, getRequestHeaders: headers });
    const session = await client.openSession();
    await assert.rejects(client.fetchBackup(session, 'h1'), (error) => error instanceof DataMaidError && error.status === 403);
});

test('concurrent 403s share one refresh', async () => {
    const server = fakeServer({
        tokens: ['t1', 't2', 't3'],
        view: (hash, token) => (token === 't1' ? new Response('', { status: 403 }) : new Response(hash)),
    });
    const client = createDataMaidClient({ fetchImpl: server.fetchImpl, getRequestHeaders: headers });
    const session = await client.openSession();
    const results = await Promise.all(['a', 'b', 'c'].map((hash) => client.fetchBackup(session, hash)));
    assert.deepEqual(await Promise.all(results.map((r) => r.blob.text())), ['a', 'b', 'c']);
    assert.equal(server.reports(), 2);
    assert.equal(session.token, 't2');
});

test('closeSession finalizes the token and never rejects', async () => {
    const server = fakeServer({ tokens: ['t1'] });
    const client = createDataMaidClient({ fetchImpl: server.fetchImpl, getRequestHeaders: headers });
    const session = await client.openSession();
    await client.closeSession(session);
    const finalize = server.calls.at(-1);
    assert.equal(finalize.url, '/api/data-maid/finalize');
    assert.equal(finalize.init.method, 'POST');
    assert.deepEqual(JSON.parse(finalize.init.body), { token: 't1' });

    const broken = createDataMaidClient({
        fetchImpl: async () => { throw new Error('offline'); },
        getRequestHeaders: headers,
    });
    await broken.closeSession({ token: 'x' });
    await broken.closeSession(null);
});
