const { DateTime } = require('luxon');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const { withUserLock } = require('../utils/withUserLock');
const { MAX_SHIFT_HOURS } = require('../constants/shifts');
const { autoBreakMinutes, clockInWindow, payPeriodOn, summarizeAcrossJobs, summarizeEntries, weekOn, summaryRangeOn, estimatedPayOf } = require('../domain/timesheet');

// The timesheet: clocking in and out, adding or fixing an entry by hand, and the
// entries for a pay period (one job) or a week (all jobs) with what they add up to.

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const withJob = { job: true };
const jobSummary = (job) => ({ id: job.id, title: job.title, companyName: job.companyName, color: job.color, hourlyRate: job.hourlyRate, payFrequency: job.payFrequency, payday: job.payday });

const findOwnEntry = async (db, userId, entryId) => {
    const entry = await db.timeEntry.findFirst({ where: { id: entryId, userId }, include: withJob });
    // Not found and not yours look the same (404), so ids can't be probed
    if (!entry) throw new ApiError(404, 'Time entry not found');
    return entry;
};

/** The rules every finished entry follows, whether the clock or the user wrote it. */
const assertValidEntry = (clockInAt, clockOutAt, breakMinutes) => {
    const now = new Date();
    if (clockInAt > now) throw new ApiError(400, 'Clock-in can’t be in the future');
    if (!clockOutAt) return;

    if (clockOutAt <= clockInAt) throw new ApiError(400, 'Clock-out must be after clock-in');
    if (clockOutAt > now) throw new ApiError(400, 'Clock-out can’t be in the future');
    if (clockOutAt.getTime() - clockInAt.getTime() > MAX_SHIFT_HOURS * HOUR_MS) throw new ApiError(400, `An entry can’t be longer than ${MAX_SHIFT_HOURS} hours — check the dates`);
    // Compared in whole minutes, like the timesheet shows them: a 2h 00m entry can't have a 120-minute break
    const clockedMinutes = Math.round((clockOutAt.getTime() - clockInAt.getTime()) / MINUTE_MS);
    if (breakMinutes >= clockedMinutes) throw new ApiError(400, 'The break can’t be as long as the whole entry');
};

/** The entry the user is clocked in on right now, or null. */
const getCurrentEntry = (userId) => prisma.timeEntry.findFirst({ where: { userId, clockOut: null }, include: withJob, orderBy: { clockIn: 'desc' } });

// Worked and missed can't both be true; the user undoes "missed" first
const missedShiftError = () => new ApiError(409, 'This shift is marked as missed — undo that first', { code: 'SHIFT_MISSED' });

/**
 * Starts the clock for a scheduled shift — only from 10 minutes before it begins
 * until it ends (400 TOO_EARLY with `opensAt`, or SHIFT_OVER). Anything else —
 * an unscheduled shift, a forgotten clock-in — is added by hand with createEntry.
 * One clock at a time: a second clock-in answers 409 ALREADY_CLOCKED_IN with the
 * open entry.
 */
const clockIn = (userId, { shiftId }) =>
    withUserLock(userId, async (tx) => {
        const open = await tx.timeEntry.findFirst({ where: { userId, clockOut: null }, include: withJob });
        if (open) throw new ApiError(409, 'You’re already clocked in', { code: 'ALREADY_CLOCKED_IN', entry: open });

        const shift = await tx.shift.findFirst({ where: { id: shiftId, userId } });
        if (!shift) throw new ApiError(404, 'Shift not found');
        if (shift.missedReason) throw missedShiftError();

        const now = new Date();
        const { opensAt, closesAt } = clockInWindow(shift);
        if (now < opensAt) throw new ApiError(400, 'You can clock in from 10 minutes before your shift starts', { code: 'TOO_EARLY', opensAt });
        if (now >= closesAt) throw new ApiError(400, 'This shift has ended — add its hours on your timesheet instead', { code: 'SHIFT_OVER' });

        return tx.timeEntry.create({ data: { userId, jobId: shift.jobId, shiftId, clockIn: now }, include: withJob });
    });

/** Stops the clock and fills in the usual unpaid break (see autoBreakMinutes); the user can change it afterwards. */
const clockOut = (userId) =>
    withUserLock(userId, async (tx) => {
        const open = await tx.timeEntry.findFirst({ where: { userId, clockOut: null } });
        if (!open) throw new ApiError(409, 'You’re not clocked in', { code: 'NOT_CLOCKED_IN' });

        const now = new Date();
        return tx.timeEntry.update({ where: { id: open.id }, data: { clockOut: now, breakMinutes: autoBreakMinutes(open.clockIn, now) }, include: withJob });
    });

/**
 * Hours typed in afterwards. With `shiftId` they are the hours for that scheduled
 * shift (forgot to clock in or out) — one entry per shift, a second answers 409
 * ENTRY_EXISTS with the one to edit. With `jobId` alone it's work that wasn't on
 * the schedule. Without `breakMinutes` the usual break is assumed.
 */
const createEntry = async (userId, { shiftId, jobId: givenJobId, clockIn: clockInAt, clockOut: clockOutAt, breakMinutes }) => {
    let jobId = givenJobId;
    if (shiftId) {
        const shift = await prisma.shift.findFirst({ where: { id: shiftId, userId }, include: { timeEntries: { include: withJob, take: 1 } } });
        if (!shift) throw new ApiError(404, 'Shift not found');
        if (shift.missedReason) throw missedShiftError();
        if (shift.timeEntries.length > 0) throw new ApiError(409, 'This shift already has hours — change them instead', { code: 'ENTRY_EXISTS', entry: shift.timeEntries[0] });
        jobId = shift.jobId;
    } else {
        const job = await prisma.job.findFirst({ where: { id: jobId, userId, isActive: true }, select: { id: true } });
        if (!job) throw new ApiError(404, 'Job not found');
    }

    const unpaidBreak = breakMinutes ?? autoBreakMinutes(clockInAt, clockOutAt);
    assertValidEntry(clockInAt, clockOutAt, unpaidBreak);
    return prisma.timeEntry.create({ data: { userId, jobId, shiftId: shiftId ?? null, clockIn: clockInAt, clockOut: clockOutAt, breakMinutes: unpaidBreak }, include: withJob });
};

/** Fix an entry: forgot to clock out, the shift ran long, a different break. */
const updateEntry = (userId, entryId, changes) =>
    withUserLock(userId, async (tx) => {
        const existing = await findOwnEntry(tx, userId, entryId);
        const clockInAt = changes.clockIn ?? existing.clockIn;
        const clockOutAt = changes.clockOut === undefined ? existing.clockOut : changes.clockOut;
        const breakMinutes = changes.breakMinutes ?? existing.breakMinutes;

        assertValidEntry(clockInAt, clockOutAt, breakMinutes);
        if (!clockOutAt) {
            // Re-opening an entry would mean two open clocks if another one is running
            const otherOpen = await tx.timeEntry.findFirst({ where: { userId, clockOut: null, id: { not: entryId } }, select: { id: true } });
            if (otherOpen) throw new ApiError(409, 'You’re already clocked in on another entry', { code: 'ALREADY_CLOCKED_IN' });
        }

        return tx.timeEntry.update({ where: { id: entryId }, data: { clockIn: clockInAt, clockOut: clockOutAt, breakMinutes }, include: withJob });
    });

const getEntry = (userId, entryId) => findOwnEntry(prisma, userId, entryId);

const deleteEntry = async (userId, entryId) => {
    const { count } = await prisma.timeEntry.deleteMany({ where: { id: entryId, userId } });
    if (count === 0) throw new ApiError(404, 'Time entry not found');
};

// "YYYY-MM-DD" for the first and last day covered (a period's `end` is the midnight after its last day)
const daysOf = ({ start, end }) => ({ start: start.toISODate(), end: end.minus({ days: 1 }).toISODate() });

/**
 * One job's timesheet for one pay period: the period's dates and payday, its
 * entries (newest first) with paid minutes, and the totals. `offset` 0 is the
 * period today falls in, -1 the one before. Days are counted in the device's
 * `timeZone`. Deleted jobs still answer, so old periods stay readable.
 */
const getTimesheet = async (userId, { jobId, offset, timeZone }) => {
    const job = await prisma.job.findFirst({ where: { id: jobId, userId } });
    if (!job) throw new ApiError(404, 'Job not found');

    const period = payPeriodOn(new Date(), job, timeZone, offset);
    const entries = await prisma.timeEntry.findMany({
        where: { userId, jobId, clockIn: { gte: period.start.toJSDate(), lt: period.end.toJSDate() } },
        orderBy: { clockIn: 'desc' },
    });

    const { taxDeductionPercent } = await prisma.user.findUnique({ where: { id: userId }, select: { taxDeductionPercent: true } });
    const summary = summarizeEntries(entries, job.hourlyRate);
    return {
        job: jobSummary(job),
        period: { ...daysOf(period), payday: period.payday?.toISODate() ?? null, offset },
        entries: summary.entries,
        totals: { ...summary.totals, estimatedPay: estimatedPayOf(summary.totals.grossPay, taxDeductionPercent) },
        taxDeductionPercent,
    };
};

/**
 * Every job together for one calendar week (Sunday–Saturday): "how much did I
 * work this week?". By week, not by pay period, because each job has its own.
 * Entries carry their job; `byJob` has a line per job, most hours first.
 */
const getWeekTimesheet = async (userId, { offset, timeZone }) => {
    const week = weekOn(new Date(), timeZone, offset);
    const entries = await prisma.timeEntry.findMany({
        where: { userId, clockIn: { gte: week.start.toJSDate(), lt: week.end.toJSDate() } },
        include: withJob,
        orderBy: { clockIn: 'desc' },
    });

    const summary = summarizeAcrossJobs(entries);
    return {
        period: { ...daysOf(week), offset },
        entries: summary.entries,
        byJob: summary.byJob.map(({ job, ...totals }) => ({ job: jobSummary(job), ...totals })),
        totals: summary.totals,
    };
};

/**
 * Every job's hours and pay for a week, two weeks, a month or all time: "how
 * much have I worked, and earned, at each job?". Per job and in total: paid
 * time, entries, gross pay (jobs with an hourly rate) and the estimate after the
 * user's own deduction percentage. The entries come too, except for `all`, which
 * is the totals only — a whole history is too long to send for a summary.
 */
const getSummary = async (userId, { range, offset, timeZone }) => {
    const span = summaryRangeOn(range, new Date(), timeZone, offset);
    const [user, entries] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId }, select: { taxDeductionPercent: true } }),
        prisma.timeEntry.findMany({
            where: { userId, ...(span && { clockIn: { gte: span.start.toJSDate(), lt: span.end.toJSDate() } }) },
            include: withJob,
            orderBy: { clockIn: 'desc' },
        }),
    ]);

    const tax = user.taxDeductionPercent;
    const summary = summarizeAcrossJobs(entries);
    const firstDay = entries.length ? DateTime.fromJSDate(entries[entries.length - 1].clockIn, { zone: timeZone }).toISODate() : null;
    return {
        range,
        period: span ? { ...daysOf(span), offset } : { start: firstDay, end: null, offset: 0 },
        entries: range === 'all' ? [] : summary.entries,
        byJob: summary.byJob.map(({ job, ...totals }) => ({ job: jobSummary(job), ...totals, estimatedPay: estimatedPayOf(totals.grossPay, tax) })),
        totals: { ...summary.totals, estimatedPay: estimatedPayOf(summary.totals.grossPay, tax) },
        taxDeductionPercent: tax,
    };
};

module.exports = { getCurrentEntry, clockIn, clockOut, createEntry, getEntry, updateEntry, deleteEntry, getTimesheet, getWeekTimesheet, getSummary };
