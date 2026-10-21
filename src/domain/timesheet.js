const { DateTime } = require('luxon');

// Timesheet rules: pay periods, unpaid breaks and paid time. Plain functions —
// the entries come from timesheet.service.
//
// An entry is `{ clockIn: Date, clockOut: Date | null, breakMinutes }`.

const MINUTE_MS = 60 * 1000;

// Ontario's Employment Standards Act: a 30-minute eating period so that nobody
// works more than 5 hours in a row, unpaid unless the employer chooses to pay it.
// Other provinces are close to this. It's a starting value — the user can change
// the break on any entry.
const BREAK_AFTER_MINUTES = 5 * 60;
const BREAK_MINUTES = 30;

// The clock for a shift can be started this long before it begins — enough to be
// at the till on time, not enough to pad the timesheet. Hours outside this are
// added or corrected by hand on the timesheet.
const CLOCK_IN_EARLY_MINUTES = 10;

const PERIOD_DAYS = { WEEKLY: 7, BIWEEKLY: 14 };
// Without a payday, periods are counted from this Sunday so they still line up with calendar weeks
const DEFAULT_PERIOD_START = '2026-01-04';

const minutesBetween = (start, end) => Math.round((end.getTime() - start.getTime()) / MINUTE_MS);

/** The unpaid break to assume for a stretch of work: 30 minutes once it's longer than 5 hours. */
const autoBreakMinutes = (clockIn, clockOut) => (minutesBetween(clockIn, clockOut) > BREAK_AFTER_MINUTES ? BREAK_MINUTES : 0);

/** When a shift's clock can be started: from 10 minutes before it begins until it ends. */
const clockInWindow = (shift) => ({
    opensAt: new Date(shift.startTime.getTime() - CLOCK_IN_EARLY_MINUTES * MINUTE_MS),
    closesAt: shift.endTime,
});

/** Minutes that count for pay: time on the clock minus the break. null while still clocked in. */
const paidMinutes = (entry) => (entry.clockOut ? Math.max(0, minutesBetween(entry.clockIn, entry.clockOut) - entry.breakMinutes) : null);

// Weeks start on Sunday, like the app's calendar (luxon: Monday = 1 … Sunday = 7)
const weekStart = (day) => day.startOf('day').minus({ days: day.weekday % 7 });

/**
 * The pay period that `date` falls in, for a job paid every one or two weeks.
 *
 * `payday` is any one payday ("YYYY-MM-DD"). A period is the full week(s),
 * Sunday to Saturday, right before the week a payday falls in — pay arriving the
 * week of Oct 18 covers Oct 4–17. Periods then repeat every 7 or 14 days.
 * `offset` steps back (-1) or forward (+1) by whole periods.
 *
 * Returns luxon DateTimes in `timeZone`: `start` (first day, midnight), `end`
 * (midnight after the last day — exclusive) and `payday` (null when unknown).
 */
const payPeriodOn = (date, { payday, payFrequency }, timeZone, offset = 0) => {
    const length = PERIOD_DAYS[payFrequency] ?? PERIOD_DAYS.BIWEEKLY;
    const knownPayday = payday ? DateTime.fromISO(payday, { zone: timeZone }) : null;
    const hasPayday = !!knownPayday?.isValid;

    const referenceStart = hasPayday
        ? weekStart(knownPayday).minus({ days: length })
        : DateTime.fromISO(DEFAULT_PERIOD_START, { zone: timeZone });

    const day = DateTime.fromJSDate(date, { zone: timeZone }).startOf('day');
    const periodsAway = Math.floor(day.diff(referenceStart, 'days').days / length) + offset;
    const start = referenceStart.plus({ days: periodsAway * length });

    return {
        start,
        end: start.plus({ days: length }),
        payday: hasPayday ? knownPayday.plus({ days: periodsAway * length }) : null,
    };
};

/**
 * Entries with their paid minutes, and the totals for pay. An entry still on the
 * clock is listed but not counted. `grossPay` is null without an hourly rate.
 */
const summarizeEntries = (entries, hourlyRate) => {
    const rows = entries.map((entry) => ({ ...entry, paidMinutes: paidMinutes(entry) }));
    const finished = rows.filter((row) => row.paidMinutes !== null);
    const totalPaidMinutes = finished.reduce((sum, row) => sum + row.paidMinutes, 0);

    return {
        entries: rows,
        totals: {
            entryCount: finished.length,
            paidMinutes: totalPaidMinutes,
            breakMinutes: finished.reduce((sum, row) => sum + row.breakMinutes, 0),
            grossPay: hourlyRate ? Math.round((totalPaidMinutes / 60) * hourlyRate * 100) / 100 : null,
        },
    };
};

/** The calendar week (Sunday to Saturday) `date` falls in — what the all-jobs timesheet shows, since each job has its own pay period. */
const weekOn = (date, timeZone, offset = 0) => {
    const start = weekStart(DateTime.fromJSDate(date, { zone: timeZone })).plus({ weeks: offset });
    return { start, end: start.plus({ days: 7 }) };
};

/** The ranges the hours summary can show. `all` is everything ever recorded. */
const SUMMARY_RANGES = ['week', 'twoWeeks', 'month', 'all'];

/**
 * The days a summary covers, in `timeZone`, or null for `all`. Weeks run Sunday
 * to Saturday like the calendar; `twoWeeks` is this week and the one before (the
 * usual biweekly stretch); `month` is the calendar month. `offset` steps back by
 * whole ranges (-1 = the one before).
 */
const summaryRangeOn = (range, date, timeZone, offset = 0) => {
    const day = DateTime.fromJSDate(date, { zone: timeZone });
    if (range === 'week') return weekOn(date, timeZone, offset);
    if (range === 'twoWeeks') {
        const start = weekStart(day).minus({ weeks: 1 }).plus({ weeks: 2 * offset });
        return { start, end: start.plus({ days: 14 }) };
    }
    if (range === 'month') {
        const start = day.startOf('month').plus({ months: offset });
        return { start, end: start.plus({ months: 1 }) };
    }
    return null;
};

const round2 = (value) => Math.round(value * 100) / 100;

/** Gross pay less the user's own deduction estimate — the same estimate Pay Summary uses. null without a gross figure. */
const estimatedPayOf = (grossPay, taxPercent) => (grossPay == null ? null : round2(grossPay * (1 - taxPercent / 100)));

/**
 * Entries from several jobs (each with its `job`) → the same rows and totals as
 * summarizeEntries, plus a line per job. Pay is only added up for jobs that have
 * an hourly rate; `missingRates` says some hours aren't in the money figure.
 */
const summarizeAcrossJobs = (entries) => {
    const groups = new Map();
    for (const entry of entries) {
        if (!groups.has(entry.jobId)) groups.set(entry.jobId, { job: entry.job, entries: [] });
        groups.get(entry.jobId).entries.push(entry);
    }

    const byJob = [...groups.values()]
        .map(({ job, entries: jobEntries }) => ({ job, ...summarizeEntries(jobEntries, job.hourlyRate).totals }))
        .sort((a, b) => b.paidMinutes - a.paidMinutes);
    const paid = byJob.filter((line) => line.grossPay !== null);

    return {
        entries: entries.map((entry) => ({ ...entry, paidMinutes: paidMinutes(entry) })),
        byJob,
        totals: {
            entryCount: byJob.reduce((sum, line) => sum + line.entryCount, 0),
            paidMinutes: byJob.reduce((sum, line) => sum + line.paidMinutes, 0),
            breakMinutes: byJob.reduce((sum, line) => sum + line.breakMinutes, 0),
            grossPay: paid.length > 0 ? Math.round(paid.reduce((sum, line) => sum + line.grossPay, 0) * 100) / 100 : null,
            missingRates: paid.length < byJob.length,
        },
    };
};

module.exports = { CLOCK_IN_EARLY_MINUTES, SUMMARY_RANGES, clockInWindow, weekOn, summaryRangeOn, estimatedPayOf, summarizeAcrossJobs, BREAK_AFTER_MINUTES, BREAK_MINUTES, autoBreakMinutes, paidMinutes, payPeriodOn, summarizeEntries };
