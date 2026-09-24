import test from 'node:test';
import assert from 'node:assert/strict';

import { createSessionManager } from '../lib/sessionManager.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

function setup({ isBrowserOpen = () => false, idleGate = Promise.resolve() } = {}) {
    const calls = [];
    let reportCount = 0;
    const dataMaid = {
        openSession: async (signal) => {
            calls.push(['openSession', signal]);
            reportCount += 1;
            return { token: `t${reportCount}`, backups: [`b${reportCount}`] };
        },
        closeSession: async (session) => { calls.push(['closeSession', session]); },
    };
    const restoreQueue = { whenIdle: () => idleGate };
    const manager = createSessionManager({ dataMaid, restoreQueue, isBrowserOpen });
    return { calls, manager };
}

test('acquire returns the same object across calls, updating it in place', async () => {
    const { calls, manager } = setup();
    const first = await manager.acquire();
    assert.deepEqual(first, { token: 't1', backups: ['b1'] });
    const second = await manager.acquire();
    assert.equal(second, first);
    assert.deepEqual(second, { token: 't2', backups: ['b2'] });
    assert.deepEqual(calls.map((call) => call[0]), ['openSession', 'openSession']);
});

test('release waits for whenIdle before closing', async () => {
    const gate = deferred();
    const { calls, manager } = setup({ idleGate: gate.promise });
    const session = await manager.acquire();
    const releasing = manager.release();
    await tick();
    assert.ok(!calls.some((call) => call[0] === 'closeSession'));
    gate.resolve();
    await releasing;
    assert.deepEqual(calls.filter((call) => call[0] === 'closeSession'), [['closeSession', session]]);
});

test('release does nothing while a popup is open', async () => {
    const { calls, manager } = setup({ isBrowserOpen: () => true });
    const session = await manager.acquire();
    await manager.release();
    assert.ok(!calls.some((call) => call[0] === 'closeSession'));
    assert.equal(await manager.acquire(), session);
});

test('after a completed release, the next acquire returns a new object', async () => {
    const { manager } = setup();
    const first = await manager.acquire();
    await manager.release();
    const second = await manager.acquire();
    assert.notEqual(second, first);
    assert.deepEqual(second, { token: 't2', backups: ['b2'] });
});
