const { DateTime } = require('luxon');

// The rules about shifts, as plain functions: no database, no Express. Services
// fetch the rows and call these, so the same code can run anywhere JavaScript
// does (tests today, the shared package for the web app later).
//
// A "shift" here is `{ startTime: Date, endTime: Date, jobId, notes?, job? }`.

const HOUR_MS = 60 * 60 * 1000;

const round2 = (value) => Math.round(value * 100) / 100;

const hoursBetween = (start, end) => (end.getTime() - start.getTime()) / HOUR_MS;

/**
 * Every pair of shifts that share time. Back-to-back shifts (one ends exactly when
 * the next starts) are fine. Sorted by start, each shift is only compared with the
 * ones that begin before it ends.
 */
const findOverlapPairs = (shifts) => {
    const sorted = [...shifts].sort((a, b) => a.startTime - b.startTime);
    const pairs = [];
    sorted.forEach((first, i) => {
        for (let j = i + 1; j < sorted.length && sorted[j].startTime < first.endTime; j++) {
            pairs.push({ first, second: sorted[j] });
        }
    });
    return pairs;
};

/** Two shifts share time. One ending exactly when the other starts doesn't count. */
const overlaps = (a, b) => a.startTime < b.endTime && a.endTime > b.startTime;

/**
 * Which of `candidates` can be added next to `existing` shifts. A candidate that
 * clashes with an existing shift — or with a candidate accepted before it — is
 * skipped rather than refused: when importing or copying, a clash is nearly
 * always the same shift arriving twice.
 */
const splitByOverlap = (candidates, existing) => {
    const taken = [...existing];
    const accepted = [];
    const skipped = [];
    for (const candidate of candidates) {
        if (taken.some((shift) => overlaps(candidate, shift))) {
            skipped.push(candidate);
        } else {
            accepted.push(candidate);
            taken.push(candidate);
        }
    }
    return { accepted, skipped };
};

/**
 * Copies of `originals`, placed either on chosen days (`targetDates`,
 * "YYYY-MM-DD") or moved by `offsetDays`. Worked out in `timeZone`:
 *  - times of day stay the same, even across a DST change (9:00 stays 9:00),
 *  - a multi-day selection keeps its spacing (Mon + Wed copied onto next Monday
 *    gives next Mon + Wed), overnight shifts keep ending the next day.
 */
const planShiftCopies = (originals, { targetDates, offsetDays, timeZone }) => {
    if (originals.length === 0) return [];

    const sorted = [...originals].sort((a, b) => a.startTime - b.startTime);
    const local = (date) => DateTime.fromJSDate(date, { zone: timeZone });
    // Target dates line up with the day the selection starts on
    const anchorDay = local(sorted[0].startTime).startOf('day');
    const offsets = offsetDays !== undefined
        ? [offsetDays]
        : targetDates.map((date) => Math.round(DateTime.fromISO(date, { zone: timeZone }).diff(anchorDay, 'days').days));

    return offsets.flatMap((days) =>
        sorted.map((shift) => ({
            jobId: shift.jobId,
            startTime: local(shift.startTime).plus({ days }).toJSDate(),
            endTime: local(shift.endTime).plus({ days }).toJSDate(),
            notes: shift.notes ?? undefined,
        }))
    );
};

/**
 * Hours and estimated pay for a set of shifts (each with its `job`), in total
 * and per job. Each shift is split at `now`: what's already worked vs what's
 * still on the schedule. Net pay is gross minus the user's own tax estimate.
 */
const summarizeShifts = (shifts, { taxPercent, now = Date.now() }) => {
    const byJobMap = new Map();
    let completedHours = 0;

    for (const shift of shifts) {
        const hours = hoursBetween(shift.startTime, shift.endTime);
        const workedUntil = Math.min(Math.max(now, shift.startTime.getTime()), shift.endTime.getTime());
        completedHours += (workedUntil - shift.startTime.getTime()) / HOUR_MS;

        if (!byJobMap.has(shift.jobId)) {
            byJobMap.set(shift.jobId, {
                jobId: shift.jobId,
                jobTitle: shift.job.title,
                companyName: shift.job.companyName,
                color: shift.job.color,
                hourlyRate: shift.job.hourlyRate,
                shiftCount: 0,
                hours: 0,
                grossPay: 0,
            });
        }

        const entry = byJobMap.get(shift.jobId);
        entry.shiftCount += 1;
        entry.hours += hours;
        if (shift.job.hourlyRate) entry.grossPay += hours * shift.job.hourlyRate;
    }

    const byJob = [...byJobMap.values()].map((job) => ({ ...job, hours: round2(job.hours), grossPay: round2(job.grossPay) }));

    const totalHours = round2(byJob.reduce((sum, job) => sum + job.hours, 0));
    const workedHours = round2(completedHours);
    const totalGrossPay = round2(byJob.reduce((sum, job) => sum + job.grossPay, 0));

    return {
        shiftCount: shifts.length,
        totalHours,
        completedHours: workedHours,
        upcomingHours: round2(totalHours - workedHours),
        totalGrossPay,
        totalNetPay: round2(totalGrossPay * (1 - taxPercent / 100)),
        taxDeductionPercent: taxPercent,
        byJob,
    };
};

module.exports = { findOverlapPairs, splitByOverlap, planShiftCopies, summarizeShifts };
