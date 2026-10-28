const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const { withUserLock } = require('../utils/withUserLock');
const { MAX_SHIFT_HOURS, MAX_SHIFTS_PER_LIST, NOT_MISSED } = require('../constants/shifts');
const { planShiftCopies, splitByOverlap, summarizeShifts } = require('../domain/shifts');

const HOUR_MS = 60 * 60 * 1000;

// Every write here is "check the time is free, then save", so it runs one request per user at a time
const withScheduleLock = withUserLock;

/** New shifts can only go on a job the user still has. 404 either way, so ids can't be probed. */
const assertActiveJobs = async (db, userId, jobIds) => {
    const uniqueIds = [...new Set(jobIds)];
    const found = await db.job.count({ where: { id: { in: uniqueIds }, userId, isActive: true } });
    if (found !== uniqueIds.length) {
        throw new ApiError(404, uniqueIds.length === 1 ? 'Job not found' : 'One or more of these jobs were not found');
    }
};

// Shifts that share any time with [startTime, endTime). Back-to-back shifts
// (one ends at 5:00, the next starts at 5:00) don't count as overlapping, and
// neither does a missed one: its time is free again (a called-off shift, re-filled).
const findOverlappingShifts = (db, userId, startTime, endTime, excludeShiftId) =>
    db.shift.findMany({
        where: {
            userId,
            ...NOT_MISSED,
            ...(excludeShiftId && { id: { not: excludeShiftId } }),
            startTime: { lt: endTime },
            endTime: { gt: startTime },
        },
        include: { job: true },
        orderBy: { startTime: 'asc' },
    });

// 409 with the clashing shifts, so the app can show them and offer "Save anyway"
// (the client then retries with allowOverlap: true).
const assertNoOverlap = async (db, userId, startTime, endTime, excludeShiftId) => {
    const conflicts = await findOverlappingShifts(db, userId, startTime, endTime, excludeShiftId);
    if (conflicts.length > 0) {
        throw new ApiError(409, 'This shift overlaps with another shift', {
            code: 'SHIFT_OVERLAP',
            conflicts,
        });
    }
};

const findOwnShift = async (db, userId, shiftId, include = { job: true }) => {
    const shift = await db.shift.findFirst({ where: { id: shiftId, userId }, include });
    // Not found and not yours look the same (404), so ids can't be probed
    if (!shift) throw new ApiError(404, 'Shift not found');
    return shift;
};

const createShift = (userId, { allowOverlap, ...data }) =>
    withScheduleLock(userId, async (tx) => {
        await assertActiveJobs(tx, userId, [data.jobId]);
        if (!allowOverlap) await assertNoOverlap(tx, userId, data.startTime, data.endTime);

        return tx.shift.create({ data: { ...data, userId }, include: { job: true } });
    });

/**
 * Copy shift / copy week / scan import. Shifts that would overlap an existing
 * one — or one earlier in the same batch — are skipped, not errors (see
 * splitByOverlap). Returns `{ created, skipped }`; it's all saved or none of it.
 */
const createShiftsBulk = (userId, shifts) =>
    withScheduleLock(userId, async (tx) => {
        await assertActiveJobs(tx, userId, shifts.map((shift) => shift.jobId));

        // One query for everything already scheduled anywhere in the batch's time span
        const spanStart = new Date(Math.min(...shifts.map((shift) => shift.startTime.getTime())));
        const spanEnd = new Date(Math.max(...shifts.map((shift) => shift.endTime.getTime())));
        const existing = await tx.shift.findMany({
            where: { userId, ...NOT_MISSED, startTime: { lt: spanEnd }, endTime: { gt: spanStart } },
            select: { startTime: true, endTime: true },
        });

        const { accepted, skipped } = splitByOverlap(shifts, existing);
        if (accepted.length === 0) return { created: [], skipped };

        const rows = await tx.shift.createManyAndReturn({
            data: accepted.map((shift) => ({ ...shift, userId })),
            select: { id: true },
        });
        const created = await tx.shift.findMany({
            where: { id: { in: rows.map((row) => row.id) } },
            include: { job: true },
            orderBy: { startTime: 'asc' },
        });
        return { created, skipped };
    });

/**
 * Copies the user's shifts onto chosen days or by a day offset (planShiftCopies
 * has the time-zone rules). Copies that clash with existing shifts are skipped
 * (see createShiftsBulk).
 */
const copyShifts = async (userId, { shiftIds, targetDates, offsetDays, timeZone }) => {
    const originals = await prisma.shift.findMany({ where: { id: { in: shiftIds }, userId } });
    if (originals.length !== new Set(shiftIds).size) throw new ApiError(404, 'One or more shifts were not found');

    return createShiftsBulk(userId, planShiftCopies(originals, { targetDates, offsetDays, timeZone }));
};

// Filters shared by the list and the summary, so both always count the same shifts
const shiftWhere = (userId, { jobId, from, to } = {}) => ({
    userId,
    ...(jobId && { jobId }),
    ...((from || to) && { startTime: { ...(from && { gte: from }), ...(to && { lte: to }) } }),
});

// The owner's reads carry the hours clocked for each shift (usually none or one), so a
// screen can show "6h 40m worked" or offer "Add hours" without a second request
const withHours = { job: true, timeEntries: { select: { id: true, clockIn: true, clockOut: true, breakMinutes: true }, orderBy: { clockIn: 'asc' } } };

const getMyShifts = (userId, filters = {}) =>
    prisma.shift.findMany({
        where: shiftWhere(userId, filters),
        include: withHours,
        orderBy: { startTime: 'asc' },
        take: MAX_SHIFTS_PER_LIST,
    });

const getShiftById = (userId, shiftId) => findOwnShift(prisma, userId, shiftId, withHours);

const updateShift = (userId, shiftId, { allowOverlap, ...data }) =>
    withScheduleLock(userId, async (tx) => {
        const existing = await findOwnShift(tx, userId, shiftId);

        // Moving the shift to another job: that job must be theirs and still active
        if (data.jobId && data.jobId !== existing.jobId) {
            await assertActiveJobs(tx, userId, [data.jobId]);
        }

        // A partial update can send just one side, so check against the stored other side.
        const startTime = data.startTime ?? existing.startTime;
        const endTime = data.endTime ?? existing.endTime;
        if (endTime <= startTime) {
            throw new ApiError(400, 'End time must be after start time');
        }
        if (endTime.getTime() - startTime.getTime() > MAX_SHIFT_HOURS * HOUR_MS) {
            throw new ApiError(400, `A shift can’t be longer than ${MAX_SHIFT_HOURS} hours — check the dates`);
        }

        // Only re-check when the times actually move — editing notes on a shift the
        // user already chose to keep overlapping shouldn't ask again.
        const timesChanged =
            startTime.getTime() !== existing.startTime.getTime() ||
            endTime.getTime() !== existing.endTime.getTime();
        if (timesChanged && !allowOverlap) {
            await assertNoOverlap(tx, userId, startTime, endTime, shiftId);
        }

        return tx.shift.update({ where: { id: shiftId }, data, include: { job: true } });
    });

/**
 * "I couldn't go" — sick, an emergency, transit, or the manager called it off; before
 * or after the shift. It stays on the schedule as a record and stops counting
 * (pay, leave-by, conflicts, clock-in). Not once it has hours on the timesheet:
 * worked and missed can't both be true, so that answers 409 HAS_HOURS.
 */
const markMissed = (userId, shiftId, { reason, note }) =>
    // Same lock as clock-in, so a clock-in can't slip in between the check and the write
    withScheduleLock(userId, async (tx) => {
        const shift = await findOwnShift(tx, userId, shiftId, { timeEntries: { select: { id: true }, take: 1 } });
        if (shift.timeEntries.length > 0) {
            throw new ApiError(409, 'This shift has hours on your timesheet — delete them first', { code: 'HAS_HOURS' });
        }
        return tx.shift.update({ where: { id: shiftId }, data: { missedReason: reason, missedNote: note ?? null }, include: withHours });
    });

/** Undo: the shift counts again. Not checked for overlaps — a clash shows with the others on Home. */
const clearMissed = async (userId, shiftId) => {
    await findOwnShift(prisma, userId, shiftId);
    return prisma.shift.update({ where: { id: shiftId }, data: { missedReason: null, missedNote: null }, include: withHours });
};

const deleteShift = async (userId, shiftId) => {
    // Shifts ke liye hard delete theek hai (Jobs ke uljat soft-delete nahi) —
    // ek shift sirf ek calendar event hai, usse "identity/history" jaisi cheez judi nahi
    const { count } = await prisma.shift.deleteMany({ where: { id: shiftId, userId } });
    if (count === 0) throw new ApiError(404, 'Shift not found');
};

/** Several at once, all or none (the assistant's "remove these"). 404 when any isn't theirs. */
const deleteShifts = (userId, shiftIds) =>
    prisma.$transaction(async (tx) => {
        const { count } = await tx.shift.deleteMany({ where: { id: { in: shiftIds }, userId } });
        if (count !== shiftIds.length) throw new ApiError(404, 'Shift not found');
    });

const getShiftsSummary = async (userId, filters = {}) => {
    const [shifts, user] = await Promise.all([
        prisma.shift.findMany({ where: shiftWhere(userId, filters), include: { job: true } }),
        prisma.user.findUnique({ where: { id: userId }, select: { taxDeductionPercent: true } }),
    ]);
    if (!user) throw new ApiError(401, 'User no longer exists');

    return summarizeShifts(shifts, { taxPercent: user.taxDeductionPercent });
};

module.exports = {
    createShift,
    getMyShifts,
    getShiftById,
    getShiftsSummary,
    updateShift,
    deleteShift,
    deleteShifts,
    markMissed,
    clearMissed,
    createShiftsBulk,
    copyShifts,
};
