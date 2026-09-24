import test from 'node:test';
import assert from 'node:assert/strict';

import { GROUP_STATUS, SNAPSHOT_STATE, groupSnapshots } from '../lib/grouping.js';

const { READY, PENDING, UNREADABLE, ERROR } = SNAPSHOT_STATE;

const summary = (chatId, createDate = 'created', userName = 'Rob') => ({
    userName, characterName: 'X', createDate, chatId, messageCount: 1, lastMessage: null,
});
const snap = (hash, mtime, state, snapshotSummary = null) => ({
    name: `${hash}.jsonl`, hash, size: 1, mtime, state, summary: snapshotSummary,
});

test('groups ready snapshots by chat, newest group and newest snapshot first', () => {
    const { groups } = groupSnapshots([
        snap('a1', 10, READY, summary('integrity:a')),
        snap('b1', 30, READY, summary('integrity:b')),
        snap('a2', 20, READY, summary('integrity:a')),
    ], [], new Map());
    assert.deepEqual(
        groups.map((group) => [group.key, group.snapshots.map((s) => s.hash)]),
        [['integrity:b', ['b1']], ['integrity:a', ['a2', 'a1']]],
    );
});

test('status precedence is restored, then exists, then deleted', () => {
    const snapshots = [
        snap('a', 3, READY, summary('integrity:a')),
        snap('b', 2, READY, summary('integrity:b')),
        snap('c', 1, READY, summary('integrity:c')),
    ];
    const existing = [
        { fileName: 'A.jsonl', chatId: 'integrity:a' },
        { fileName: 'B.jsonl', chatId: 'integrity:b' },
    ];
    const restored = new Map([['integrity:a', 'A restored.jsonl']]);
    const { groups } = groupSnapshots(snapshots, existing, restored);
    assert.deepEqual(groups.map((g) => [g.key, g.status, g.fileName]), [
        ['integrity:a', GROUP_STATUS.RESTORED, 'A restored.jsonl'],
        ['integrity:b', GROUP_STATUS.EXISTS, 'B.jsonl'],
        ['integrity:c', GROUP_STATUS.DELETED, null],
    ]);
});

test('status is unknown until the current chats are known, unless restored', () => {
    const snapshots = [snap('a', 2, READY, summary('integrity:a')), snap('b', 1, READY, summary('integrity:b'))];
    const { groups } = groupSnapshots(snapshots, null, new Map([['integrity:b', 'B.jsonl']]));
    assert.deepEqual(groups.map((g) => g.status), [GROUP_STATUS.UNKNOWN, GROUP_STATUS.RESTORED]);
});

test('pending, unreadable and failed snapshots stay out of the groups', () => {
    const { groups, problems, pending } = groupSnapshots([
        snap('p1', 5, PENDING),
        snap('u1', 4, UNREADABLE),
        snap('e1', 6, ERROR),
        snap('r1', 1, READY, summary('integrity:a')),
        snap('p2', 7, PENDING),
    ], [], new Map());
    assert.deepEqual(groups.map((g) => g.key), ['integrity:a']);
    assert.deepEqual(problems.map((s) => s.hash), ['e1', 'u1']);
    assert.deepEqual(pending.map((s) => s.hash), ['p2', 'p1']);
});

test('a snapshot without a chat id gets a group of its own and never matches a current chat', () => {
    const { groups } = groupSnapshots([
        snap('x', 2, READY, summary(null)),
        snap('y', 1, READY, summary(null)),
    ], [{ fileName: 'Z.jsonl', chatId: null }], new Map());
    assert.deepEqual(groups.map((g) => [g.key, g.status]), [
        ['snapshot:x', GROUP_STATUS.DELETED],
        ['snapshot:y', GROUP_STATUS.DELETED],
    ]);
});

test('the group header uses the newest snapshot', () => {
    const { groups } = groupSnapshots([
        snap('old', 1, READY, summary('integrity:a', 'first', 'Alex')),
        snap('new', 2, READY, summary('integrity:a', 'second', 'Rob')),
    ], [], new Map());
    assert.equal(groups[0].createDate, 'second');
    assert.equal(groups[0].userName, 'Rob');
});

test('inputs are not reordered', () => {
    const snapshots = [snap('a1', 1, READY, summary('integrity:a')), snap('a2', 2, READY, summary('integrity:a'))];
    groupSnapshots(snapshots, [], new Map());
    assert.deepEqual(snapshots.map((s) => s.hash), ['a1', 'a2']);
});
