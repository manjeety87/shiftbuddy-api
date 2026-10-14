const { DateTime } = require('luxon');

// Turning what the schedule reader saw into shifts we can trust. A photo says
// "9:00" — it has no time zone — so the reader is asked for plain wall-clock
// times and the zone is applied here, from the user's device. (Letting the
// server's own clock decide put every scanned shift hours off once the server
// wasn't in the user's zone.) No database here.

const MAX_NOTES = 500;
const MIN_TERM_LENGTH = 2;

/** "2026-10-05T09:00…" (anything after the minutes, like a stray "Z", is ignored) → that wall-clock time in `zone`. */
const wallClock = (value, zone) => {
    const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(String(value ?? '').trim());
    if (!match) return null;
    const time = DateTime.fromISO(`${match[1]}T${match[2]}`, { zone });
    return time.isValid ? time : null;
};

/**
 * Reader output → `{ startTime, endTime (UTC ISO), notes?, needsReview }`.
 * Entries without readable times are dropped. An end at or before its start is
 * an overnight shift written with one date: it ends the next day, flagged for review.
 */
const normalizeScannedShifts = (rawShifts, timeZone) =>
    (Array.isArray(rawShifts) ? rawShifts : []).flatMap((raw) => {
        const start = wallClock(raw?.startTime, timeZone);
        const sameDayEnd = wallClock(raw?.endTime, timeZone);
        if (!start || !sameDayEnd) return [];

        const isOvernight = sameDayEnd <= start;
        const end = isOvernight ? sameDayEnd.plus({ days: 1 }) : sameDayEnd;
        if (end <= start || end.diff(start, 'hours').hours > 24) return [];

        const notes = typeof raw.notes === 'string' ? raw.notes.trim().slice(0, MAX_NOTES) : '';
        return [{
            startTime: start.toUTC().toISO(),
            endTime: end.toUTC().toISO(),
            ...(notes && { notes }),
            needsReview: Boolean(raw.needsReview) || isOvernight,
        }];
    });

const termsOf = (job) =>
    [job.companyName, job.title, ...(job.matchKeywords ?? '').split(',')]
        .map((term) => (term ?? '').trim().toLowerCase())
        .filter((term) => term.length >= MIN_TERM_LENGTH);

/**
 * Which job a scanned shift belongs to, from the label the reader found next to
 * it (`notes`): a job matches when its workplace, role or one of its keywords
 * appears there. Only an unambiguous match is suggested — a wrong guess is worse
 * than asking.
 */
const suggestJobId = (shift, jobs) => {
    const label = (shift.notes ?? '').toLowerCase();
    if (!label) return null;
    const matches = jobs.filter((job) => termsOf(job).some((term) => label.includes(term)));
    return matches.length === 1 ? matches[0].id : null;
};

module.exports = { normalizeScannedShifts, suggestJobId };
