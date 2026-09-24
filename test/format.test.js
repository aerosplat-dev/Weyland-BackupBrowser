import test from 'node:test';
import assert from 'node:assert/strict';

import { formatCreateDate, formatSize, formatTime } from '../lib/format.js';

test('formatSize uses B, KB and MB', () => {
    assert.equal(formatSize(512), '512 B');
    assert.equal(formatSize(2048), '2 KB');
    assert.equal(formatSize(3359358), '3.2 MB');
    assert.equal(formatSize(Number.NaN), '');
    assert.equal(formatSize(-1), '');
});

test('formatTime formats an epoch-ms instant and ignores non-numbers', () => {
    const ms = new Date(2026, 8, 21, 12, 52).getTime();
    assert.equal(
        formatTime(ms, 'en-US'),
        new Date(ms).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }),
    );
    assert.equal(formatTime(Number.NaN, 'en-US'), '');
});

test('formatCreateDate reads SillyTavern create_date strings as local time', () => {
    const expected = formatTime(new Date(2026, 8, 11, 19, 59, 15).getTime(), 'en-US');
    assert.equal(formatCreateDate('2026-09-11@19h59m15s', 'en-US'), expected);
    assert.equal(formatCreateDate('2026-9-1@7h5m3s', 'en-US'), formatTime(new Date(2026, 8, 1, 7, 5, 3).getTime(), 'en-US'));
    assert.equal(formatCreateDate('something else', 'en-US'), 'something else');
    assert.equal(formatCreateDate(undefined, 'en-US'), '');
});
