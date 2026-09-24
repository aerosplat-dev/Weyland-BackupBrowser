import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIPPED_DIRECTORIES = new Set(['test', 'docs', 'node_modules', '.git']);

function sourceFiles(dir) {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIPPED_DIRECTORIES.has(entry.name)) files.push(...sourceFiles(full));
        } else if (/\.(js|css|html)$/.test(entry.name)) {
            files.push(full);
        }
    }
    return files;
}

const FORBIDDEN = [
    { pattern: /data-maid\/delete/, why: 'the extension never deletes backups' },
    { pattern: /chats\/delete/, why: 'the extension never deletes chats' },
    { pattern: /chats\/save/, why: 'restores go through import, which does not create or evict a backup' },
    { pattern: /\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML/, why: 'backup content is only ever inserted as text' },
    { pattern: /position:\s*fixed/, why: 'the native Popup is the only overlay' },
    { pattern: /third-party\//, why: 'no hardcoded extension location' },
    {
        pattern: /\bchat\.(push|splice|pop|shift|unshift)\s*\(|\bchat\.length\s*=(?!=)|chatMetadata|chat_metadata\s*\[|saveChat|saveMetadata|updateChatMetadata/,
        why: 'the live chat and its metadata are never written',
    },
    { pattern: /\.\s*variables\b|\[\s*['"]variables['"]\s*\]/, why: 'backup headers carry chat variables (including the decoded master prompt); they are never read' },
    { pattern: /createObjectURL/, why: 'backups are never offered as a download' },
    { pattern: /console\.log\(/, why: 'nothing is logged except warnings and errors, and never backup text' },
];

test('source files keep the safety invariants', () => {
    const files = sourceFiles(root);
    assert.ok(files.length > 0, 'no source files found');
    for (const file of files) {
        const text = fs.readFileSync(file, 'utf8');
        for (const { pattern, why } of FORBIDDEN) {
            assert.doesNotMatch(text, pattern, `${path.relative(root, file)}: ${why}`);
        }
    }
});
