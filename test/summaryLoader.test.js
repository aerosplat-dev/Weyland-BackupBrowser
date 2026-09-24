import test from 'node:test';
import assert from 'node:assert/strict';

import { createSummaryLoader } from '../lib/summaryLoader.js';

const VALID = [
    JSON.stringify({ user_name: 'Rob', character_name: 'Bap', create_date: 'c', chat_metadata: { integrity: 'u' } }),
    JSON.stringify({ name: 'Bap', mes: 'hi' }),
].join('\n');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const snapshots = (...hashes) => hashes.map((hash, index) => ({ hash, size: 1, mtime: index }));

test('reads uncached snapshots once and caches summaries, including unreadable ones', async () => {
    const fetched = [];
    const dataMaid = {
        fetchBackup: async (session, hash) => {
            fetched.push(hash);
            return { status: 'ok', blob: new Blob([hash === 'bad' ? 'not json' : VALID]) };
        },
    };
    const loader = createSummaryLoader({ dataMaid });
    const list = snapshots('a', 'bad');
    const results = [];
    await loader.loadAll({}, list, { onResult: (snapshot, result) => results.push([snapshot.hash, result.status, result.summary?.userName ?? null]) });
    assert.deepEqual(results, [['a', 'ok', 'Rob'], ['bad', 'ok', null]]);
    assert.equal(loader.cached(list[0]).userName, 'Rob');
    assert.equal(loader.cached(list[1]), null);
    assert.equal(loader.cached({ hash: 'a', size: 2, mtime: 0 }), undefined);

    await loader.loadAll({}, list, { onResult: () => assert.fail('nothing left to read') });
    assert.deepEqual(fetched, ['a', 'bad']);
});

test('never runs more than `concurrency` reads at once, in the given order', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const started = [];
    const dataMaid = {
        fetchBackup: async (session, hash) => {
            started.push(hash);
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await tick();
            inFlight -= 1;
            return { status: 'ok', blob: new Blob([VALID]) };
        },
    };
    const loader = createSummaryLoader({ dataMaid, concurrency: 2 });
    await loader.loadAll({}, snapshots('a', 'b', 'c', 'd', 'e'), { onResult: () => {} });
    assert.equal(maxInFlight, 2);
    assert.deepEqual(started, ['a', 'b', 'c', 'd', 'e']);
});

test('passes the session and signal through', async () => {
    const seen = [];
    const signal = new AbortController().signal;
    const session = { token: 't' };
    const dataMaid = {
        fetchBackup: async (s, hash, sig) => { seen.push([s, sig]); return { status: 'ok', blob: new Blob([VALID]) }; },
    };
    await createSummaryLoader({ dataMaid }).loadAll(session, snapshots('a'), { signal, onResult: () => {} });
    assert.equal(seen[0][0], session);
    assert.equal(seen[0][1], signal);
});

test('stops after an abort and reports nothing more', async () => {
    const controller = new AbortController();
    const fetched = [];
    const results = [];
    const dataMaid = {
        fetchBackup: async (session, hash) => {
            fetched.push(hash);
            controller.abort();
            return { status: 'ok', blob: new Blob([VALID]) };
        },
    };
    const loader = createSummaryLoader({ dataMaid, concurrency: 1 });
    await loader.loadAll({}, snapshots('a', 'b', 'c'), { signal: controller.signal, onResult: (s) => results.push(s.hash) });
    assert.deepEqual(fetched, ['a']);
    assert.deepEqual(results, []);
});

test('reports gone and failed reads without caching them', async () => {
    const dataMaid = {
        fetchBackup: async (session, hash) => {
            if (hash === 'gone') return { status: 'gone' };
            throw new Error('network');
        },
    };
    const loader = createSummaryLoader({ dataMaid });
    const list = snapshots('gone', 'broken');
    const results = [];
    await loader.loadAll({}, list, { onResult: (snapshot, result) => results.push([snapshot.hash, result.status]) });
    assert.deepEqual(results.sort(), [['broken', 'error'], ['gone', 'gone']]);
    assert.equal(loader.cached(list[0]), undefined);
    assert.equal(loader.cached(list[1]), undefined);
});
