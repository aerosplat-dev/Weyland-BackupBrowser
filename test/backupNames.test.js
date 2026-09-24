import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
    characterBackupKey,
    matchBackupsToCharacters,
    parseBackupFileName,
    sanitizeFilename,
} from '../lib/backupNames.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Walks up from `start` until `relative` exists; null if it never does. */
function findUpward(start, relative) {
    let dir = start;
    for (;;) {
        const candidate = path.join(dir, relative);
        if (fs.existsSync(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

const sanitizePackage = findUpward(here, path.join('node_modules', 'sanitize-filename', 'package.json'));
const realSanitize = sanitizePackage ? createRequire(sanitizePackage)('./index.js') : null;
const skipParity = realSanitize ? false : 'sanitize-filename was not found above this extension';
const serverKey = (avatar) => realSanitize(String(avatar).replace('.png', ''))
    .replace(/[^a-z0-9]/gi, '_')
    .toLowerCase();

const CRAFTED = [
    'Bap.png',
    'Cerberus Sisters.png',
    'Professor Akiyama.png',
    'Lyris & Vesper.png',
    'Ṇ̶̰̼͘a̶͍̅́̒r̵̓̏̉̈́ā̸͒̔̄.png',
    'a:b*c?d.png',
    'tab\there.png',
    'trailing dots....png',
    'con.png',
    'LPT1.txt.png',
    '...png',
    'emoji 😀 name.png',
    'x.png.png',
    `${'é'.repeat(200)}.png`,
    `${'😀'.repeat(70)}.png`,
    'noext',
];

test('parseBackupFileName splits the key from the timestamp; keys may contain underscores', () => {
    assert.deepEqual(
        parseBackupFileName('chat_cerberus_sisters_20260921-125222.jsonl'),
        { key: 'cerberus_sisters', stamp: '20260921-125222' },
    );
    assert.deepEqual(
        parseBackupFileName('chat_bap_20260908-105331.jsonl'),
        { key: 'bap', stamp: '20260908-105331' },
    );
    assert.deepEqual(
        parseBackupFileName('chat_a_20260101-000000_20260102-000000.jsonl'),
        { key: 'a_20260101-000000', stamp: '20260102-000000' },
    );
});

test('parseBackupFileName rejects everything that is not a chat backup', () => {
    for (const name of [
        'settings_default-user_20260908-105331.json',
        'chat_bap_20260908-105331.json',
        'chat_bap.jsonl',
        'chat__20260908-105331.jsonl', // an empty key can't be tied to a character
        '_sysprompt',
        '',
        null,
        undefined,
    ]) {
        assert.equal(parseBackupFileName(name), null, String(name));
    }
});

test('characterBackupKey reproduces known backup keys', () => {
    assert.equal(characterBackupKey('Bap.png'), 'bap');
    assert.equal(characterBackupKey('Cerberus Sisters.png'), 'cerberus_sisters');
    assert.equal(characterBackupKey('Professor Akiyama.png'), 'professor_akiyama');
    // sanitize-filename removes illegal characters before the underscore pass
    assert.equal(characterBackupKey('a:b.png'), 'ab');
    // the server only drops the first ".png"
    assert.equal(characterBackupKey('x.png.png'), 'x_png');
});

test('sanitizeFilename matches the real sanitize-filename package', { skip: skipParity }, () => {
    for (const input of [...CRAFTED, '\u0080ctrl', ' ', '.', '..', 'a'.repeat(300)]) {
        assert.equal(sanitizeFilename(input), realSanitize(input), JSON.stringify(input));
    }
});

test('characterBackupKey matches the server rule for crafted avatars', { skip: skipParity }, () => {
    for (const avatar of CRAFTED) {
        assert.equal(characterBackupKey(avatar), serverKey(avatar), avatar);
    }
});

test('characterBackupKey matches the server rule for every avatar on this deployment', { skip: skipParity }, (t) => {
    const charactersDir = findUpward(here, 'characters');
    if (!charactersDir) {
        t.skip('no characters folder above this extension');
        return;
    }
    const avatars = fs.readdirSync(charactersDir).filter((file) => file.endsWith('.png'));
    for (const avatar of avatars) {
        assert.equal(characterBackupKey(avatar), serverKey(avatar), avatar);
    }
});

const backup = (name, mtime) => ({ name, hash: `hash-${name}`, size: 10, mtime });

test('matchBackupsToCharacters ties backups to characters, newest first, and drops orphans', () => {
    const characters = [
        { avatar: 'Bap.png', name: 'Bap' },
        { avatar: 'Cerberus Sisters.png', name: 'Cerberus Sisters' },
        { avatar: 'Kai.png', name: 'Kai' },
    ];
    const result = matchBackupsToCharacters([
        backup('chat_bap_20260908-105331.jsonl', 100),
        backup('chat_bap_20260908-105341.jsonl', 300),
        backup('chat_cerberus_sisters_20260921-125222.jsonl', 200),
        backup('chat_ghost_20260101-000000.jsonl', 999),
        backup('settings_default-user_20260101-000000.json', 999),
    ], characters);

    assert.deepEqual(
        result.map((entry) => [entry.avatar, entry.name, entry.backups.map((b) => b.mtime)]),
        [
            ['Bap.png', 'Bap', [300, 100]],
            ['Cerberus Sisters.png', 'Cerberus Sisters', [200]],
        ],
    );
});

test('matchBackupsToCharacters drops keys shared by several characters', () => {
    const characters = [
        { avatar: 'Bap.png', name: 'Bap' },
        { avatar: 'bap.png', name: 'bap' },
        { avatar: 'Kai.png', name: 'Kai' },
    ];
    const result = matchBackupsToCharacters([
        backup('chat_bap_20260908-105331.jsonl', 1),
        backup('chat_kai_20260908-105331.jsonl', 2),
    ], characters);
    assert.deepEqual(result.map((entry) => entry.avatar), ['Kai.png']);
});

test('matchBackupsToCharacters ignores characters without an avatar', () => {
    const result = matchBackupsToCharacters(
        [backup('chat_bap_20260908-105331.jsonl', 1)],
        [{ name: 'No avatar' }, null, { avatar: 'Bap.png', name: 'Bap' }],
    );
    assert.deepEqual(result.map((entry) => entry.avatar), ['Bap.png']);
});
