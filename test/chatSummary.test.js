import test from 'node:test';
import assert from 'node:assert/strict';

import {
    EXCERPT_LENGTH,
    chatIdFromHeader,
    parseBackupMessages,
    summarizeBackup,
} from '../lib/chatSummary.js';

const SECRET = 'SECRET-MASTER-PROMPT-TEXT';

const HEADER = {
    user_name: 'Rob',
    character_name: 'Cerberus Sisters',
    create_date: '2026-09-11@19h59m15s',
    chat_metadata: {
        integrity: 'ae2e15be-0ec5-43ee-877c-2e27b15e899b',
        variables: { ravteg: SECRET, postrav: SECRET },
        note_prompt: SECRET,
        world_info: 'Chat Book',
    },
};

const backupText = (header, messages) => [header, ...messages].map((line) => JSON.stringify(line)).join('\n');

test('summarizes the header fields and the last message', () => {
    const summary = summarizeBackup(backupText(HEADER, [
        { name: 'Cerberus Sisters', is_user: false, mes: 'Hello', send_date: 'September 21, 2026 12:40pm' },
        { name: 'Rob', is_user: true, mes: 'Hi there', send_date: 'September 21, 2026 12:52pm' },
    ]));
    assert.deepEqual(summary, {
        userName: 'Rob',
        characterName: 'Cerberus Sisters',
        createDate: '2026-09-11@19h59m15s',
        chatId: 'integrity:ae2e15be-0ec5-43ee-877c-2e27b15e899b',
        messageCount: 2,
        lastMessage: { name: 'Rob', excerpt: 'Hi there', sendDate: 'September 21, 2026 12:52pm' },
    });
});

test('never carries header content beyond the display fields', () => {
    const summary = summarizeBackup(backupText(HEADER, [{ name: 'Rob', mes: 'x' }]));
    assert.ok(!JSON.stringify(summary).includes(SECRET));
    assert.deepEqual(
        Object.keys(summary).sort(),
        ['characterName', 'chatId', 'createDate', 'lastMessage', 'messageCount', 'userName'],
    );
});

test('chatIdFromHeader prefers integrity and falls back to create_date', () => {
    assert.equal(chatIdFromHeader({ create_date: 'c', chat_metadata: { integrity: 'u' } }), 'integrity:u');
    assert.equal(chatIdFromHeader({ create_date: 'c', chat_metadata: { integrity: '' } }), 'created:c');
    assert.equal(chatIdFromHeader({ create_date: 'c' }), 'created:c');
    assert.equal(chatIdFromHeader({}), null);
    assert.equal(chatIdFromHeader(null), null);
});

test('counts non-empty message lines and takes the last parseable one', () => {
    const text = `${backupText(HEADER, [{ name: 'A', mes: 'one' }])}\n{broken\n\n`;
    const summary = summarizeBackup(text);
    assert.equal(summary.messageCount, 2);
    assert.deepEqual(summary.lastMessage, { name: 'A', excerpt: 'one', sendDate: '' });
});

test('a header-only backup has no messages', () => {
    const summary = summarizeBackup(JSON.stringify(HEADER));
    assert.equal(summary.messageCount, 0);
    assert.equal(summary.lastMessage, null);
});

test('long last messages keep their ending', () => {
    const mes = `${'a'.repeat(10)}${'b'.repeat(EXCERPT_LENGTH)}`;
    const summary = summarizeBackup(backupText(HEADER, [{ name: 'A', mes }]));
    assert.equal(summary.lastMessage.excerpt, `…${'b'.repeat(EXCERPT_LENGTH)}`);
});

test('headers that core import would reject are unreadable', () => {
    for (const text of ['', 'not json', '[]', '"text"', 'null', JSON.stringify({ character_name: 'x' })]) {
        assert.equal(summarizeBackup(text), null, text);
    }
    assert.equal(summarizeBackup(JSON.stringify({ name: 'x' })).userName, 'x');
    assert.equal(summarizeBackup(undefined), null);
});

test('parseBackupMessages lists messages only, never the header', () => {
    const text = `${backupText(HEADER, [
        { name: 'Cerberus Sisters', is_user: false, mes: 'Hello\nthere', send_date: 'd1' },
        { name: 'Rob', is_user: true, mes: 'Hi', send_date: 'd2', extra: { note: SECRET } },
        { name: 'System', is_system: true },
    ])}\n{broken`;
    const messages = parseBackupMessages(text);
    assert.deepEqual(messages, [
        { name: 'Cerberus Sisters', sendDate: 'd1', text: 'Hello\nthere', isUser: false },
        { name: 'Rob', sendDate: 'd2', text: 'Hi', isUser: true },
        { name: 'System', sendDate: '', text: '', isUser: false },
    ]);
    assert.ok(!JSON.stringify(messages).includes(SECRET));
    assert.deepEqual(parseBackupMessages(undefined), []);
});
