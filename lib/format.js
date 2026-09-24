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
