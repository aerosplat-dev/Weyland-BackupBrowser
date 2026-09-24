const CREATE_DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})@(\d{1,2})h(\d{1,2})m(\d{1,2})s/;

/**
 * @param {number} bytes
 * @returns {string}
 */
export function formatSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * @param {number} ms Epoch milliseconds.
 * @param {string} [locale]
 * @returns {string}
 */
export function formatTime(ms, locale) {
    if (!Number.isFinite(ms)) return '';
    return new Date(ms).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * A backup's time, compact enough for one row on a phone: seconds tell apart backups taken
 * seconds apart, and the year is dropped when it is the current one.
 * @param {number} ms Epoch milliseconds.
 * @param {string} [locale]
 * @param {number} [now]
 * @returns {string}
 */
export function formatSnapshotTime(ms, locale, now = Date.now()) {
    if (!Number.isFinite(ms)) return '';
    const date = new Date(ms);
    const sameYear = date.getFullYear() === new Date(now).getFullYear();
    return date.toLocaleString(locale, {
        year: sameYear ? undefined : 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
    });
}

/**
 * Collapses runs of blank lines and trims, for short previews of message text.
 * @param {string} text
 * @returns {string}
 */
export function compactText(text) {
    return String(text ?? '').replace(/\n[ \t]*(?:\n[ \t]*)+/g, '\n').trim();
}

/**
 * SillyTavern's create_date ("2026-09-11@19h59m15s") as a local date and time.
 * @param {string} createDate
 * @param {string} [locale]
 * @returns {string}
 */
export function formatCreateDate(createDate, locale) {
    const match = CREATE_DATE_RE.exec(createDate ?? '');
    if (!match) return String(createDate ?? '');
    const [, year, month, day, hour, minute, second] = match.map(Number);
    return formatTime(new Date(year, month - 1, day, hour, minute, second).getTime(), locale);
}
