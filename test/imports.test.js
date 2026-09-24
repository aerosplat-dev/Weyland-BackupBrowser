import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function jsFiles(dir) {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...jsFiles(full));
        else if (entry.name.endsWith('.js')) files.push(full);
    }
    return files;
}

test('every lib module loads in Node without touching browser globals', async () => {
    const files = jsFiles(path.join(root, 'lib'));
    for (const expected of ['ui/dom.js', 'ui/chatsView.js', 'ui/previewPopup.js', 'ui/browserPopup.js']) {
        assert.ok(files.includes(path.join(root, 'lib', expected)), `missing lib/${expected}`);
    }
    for (const file of files) {
        await import(pathToFileURL(file).href);
    }
});
