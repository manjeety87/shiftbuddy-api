const { DateTime } = require('luxon');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const { generateWithFallback } = require('../utils/gemini');
const shiftService = require('./shift.service');
const jobService = require('./job.service');
const { findConflicts } = require('./conflict.service');
const timesheetService = require('./timesheet.service');
const { NOT_MISSED } = require('../constants/shifts');
const { ASSISTANT_TURN_BUDGET_MS, TRANSCRIBE_BUDGET_MS, MAX_ASSISTANT_MESSAGE, MAX_ASSISTANT_STEPS, CONTEXT_DAYS_BEFORE, CONTEXT_DAYS_AFTER, MAX_CONTEXT_SHIFTS, MAX_LOOKUP_DAYS, MAX_LOOKUP_SHIFTS } = require('../constants/assistant');
const { quickAnswer, saysYes, languageOf, quickReplyText, quickReplySpeech, localToDate, spanOn, describeShift, describeProposal, sameJobShiftToChange, changeText, clashText, nextJobColour, buildSystemPrompt, assistantTools } = require('../domain/assistant');
const { jobName } = require('../domain/jobLabels');
const { overlaps } = require('../domain/shifts');
const { resolveFeatures } = require('../domain/features');
const { autoBreakMinutes, clockOutForPaid } = require('../domain/timesheet');
const { createShiftSchema, updateShiftSchema } = require('../validation/shift.validation');
const { createJobSchema, updateJobSchema } = require('../validation/job.validation');

const jobFields = { id: true, title: true, companyName: true, color: true };
const shiftFields = { id: true, startTime: true, endTime: true, missedReason: true, job: { select: jobFields }, timeEntries: { select: { id: true, clockIn: true, clockOut: true, breakMinutes: true } } };

const GEMINI_MESSAGES = {
    label: 'Assistant',
    busyMessage: 'The assistant is busy right now — try again in a moment',
    failMessage: 'The assistant couldn’t answer that — try again',
    // A spoken reply can't wait for a second pass, or on a model that hangs: the next one
    // answers in a second or two. The person can always just ask again.
    secondPass: false,
    // Long enough for a model with a full schedule in the prompt; seen timing out at 9 s (2026-11-04)
    timeoutMs: 12000,
    quotaMessage: 'The assistant has used up its free requests for now — try again later, or use the app’s own buttons',
};

const roleOf = (job) => (job.companyName?.trim() ? job.title : null);
const jobCard = (job) => ({ jobName: jobName(job), role: roleOf(job), color: job.color });

/** The person, their jobs and the schedule around today — one round trip, all scoped by userId. */
const loadContext = async (userId, now, timeZone) => {
    const today = DateTime.fromJSDate(now, { zone: timeZone }).startOf('day');
    const [user, jobs, shifts] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId }, select: { name: true, features: true } }),
        prisma.job.findMany({ where: { userId, isActive: true }, select: jobFields, orderBy: { createdAt: 'asc' } }),
        prisma.shift.findMany({
            where: { userId, startTime: { gte: today.minus({ days: CONTEXT_DAYS_BEFORE }).toJSDate(), lt: today.plus({ days: CONTEXT_DAYS_AFTER + 1 }).toJSDate() } },
            select: shiftFields,
            orderBy: { startTime: 'asc' },
            take: MAX_CONTEXT_SHIFTS,
        }),
    ]);
    if (!user) throw new ApiError(401, 'User no longer exists');
    return { user, features: resolveFeatures(user.features), jobs, shifts, shiftsById: new Map(shifts.map((shift) => [shift.id, shift])) };
};

/** One of their shifts, from the context if it's there, else the database (404 when not theirs). */
const ownShift = async (userId, context, shiftId) => {
    const known = context.shiftsById.get(shiftId);
    if (known) return known;
    const shift = await prisma.shift.findFirst({ where: { id: shiftId, userId }, select: shiftFields });
    if (shift) context.shiftsById.set(shift.id, shift);
    return shift;
};

/**
 * The card for a proposal: the proposal itself (what gets saved) plus `preview`
 * (what the card shows). Throws a plain Error the model can read when the
 * proposal can't be made — wrong id, a shift that already has hours, and so on.
 * `checkClash`: a fresh card from the model that lands on a shift they already have
 * is sent back once — "Thursday is now 2 to 10" means change that shift, not add one.
 * `changeSameJob`: a fresh card that lands on a shift at the same job becomes a change
 * of that shift (`sameJobShiftToChange`). Not for a waiting card: it mustn't turn into
 * another card under the person.
 */
const cardFor = async (userId, context, proposal, { checkClash = false, changeSameJob = false } = {}) => {
    const knownJob = (jobId) => {
        const job = context.jobs.find((item) => item.id === jobId);
        if (!job) throw new Error(`Unknown jobId ${jobId} — use an id from JOBS`);
        return job;
    };

    if (proposal.type === 'addJob') {
        const checked = createJobSchema.safeParse({ color: nextJobColour(context.jobs), ...proposal.job });
        if (!checked.success) throw new Error(`Can’t add that job: ${checked.error.issues[0].message}`);
        const twin = context.jobs.find((job) => jobName(job).toLowerCase() === jobName(checked.data).toLowerCase());
        if (twin) throw new Error(`They already have ${jobName(twin)} (${twin.id}) — change it with edit_job, or ask how the new one differs`);
        return { type: 'addJob', job: checked.data, preview: jobCard(checked.data) };
    }

    if (proposal.type === 'editJob') {
        const job = knownJob(proposal.jobId);
        const checked = updateJobSchema.safeParse(proposal.changes);
        if (!checked.success) throw new Error(`Can’t change that job: ${checked.error.issues[0].message}`);
        if (Object.keys(checked.data).length === 0) throw new Error('Nothing to change — give companyName, title or hourlyRate');
        return { ...proposal, changes: checked.data, preview: { before: jobCard(job), after: jobCard({ ...job, ...checked.data }) } };
    }

    if (proposal.type === 'deleteJob') {
        const job = knownJob(proposal.jobId);
        const upcomingShifts = await prisma.shift.count({ where: { userId, jobId: job.id, startTime: { gt: new Date() } } });
        return { ...proposal, preview: { ...jobCard(job), upcomingShifts } };
    }

    if (proposal.type === 'logHours') return hoursCard(userId, context, proposal);

    if (proposal.type === 'addShifts') {
        const jobOf = (id) => context.jobs.find((job) => job.id === id);
        const missing = proposal.shifts.find((shift) => !jobOf(shift.jobId));
        if (missing) throw new Error(`Unknown jobId ${missing.jobId} — use an id from JOBS`);

        const spanStart = new Date(Math.min(...proposal.shifts.map((shift) => shift.startTime.getTime())));
        const spanEnd = new Date(Math.max(...proposal.shifts.map((shift) => shift.endTime.getTime())));
        const existing = await prisma.shift.findMany({
            where: { userId, ...NOT_MISSED, startTime: { lt: spanEnd }, endTime: { gt: spanStart } },
            select: { id: true, startTime: true, endTime: true, job: { select: jobFields } },
        });
        const clashes = existing.filter((shift) => proposal.shifts.some((candidate) => overlaps(candidate, shift)));
        const toChange = changeSameJob && sameJobShiftToChange(proposal.shifts, clashes);
        if (toChange) {
            const [shift] = proposal.shifts;
            return cardFor(userId, context, { type: 'editShift', shiftId: toChange.id, jobId: shift.jobId, startTime: shift.startTime, endTime: shift.endTime });
        }
        if (checkClash && clashes.length > 0) {
            // By id: the model reads its times from SCHEDULE, in their zone
            const listed = clashes.map((shift) => `${jobName(shift.job)} (${shift.id})`).join('; ');
            throw new Error(
                `They already have a shift at that time: ${listed}. If that shift's time or day changed, use edit_shift on it. If it's off their schedule and this replaces it, remove it with remove_shifts. Only if they said this is an extra shift, call add_shifts again with extraShift true.`
            );
        }
        return {
            ...proposal,
            // One shift: the card shows the clash, and a yes means "save anyway". Several: clashing ones are skipped.
            allowOverlap: proposal.shifts.length === 1 && clashes.length > 0,
            preview: {
                shifts: proposal.shifts.map((shift) => ({ ...jobCard(jobOf(shift.jobId)), startTime: shift.startTime, endTime: shift.endTime, notes: shift.notes ?? null })),
                overlaps: clashes.map((shift) => ({ ...jobCard(shift.job), startTime: shift.startTime, endTime: shift.endTime })),
            },
        };
    }

    if (proposal.type === 'removeShifts') {
        const shifts = [];
        for (const shiftId of new Set(proposal.shiftIds)) {
            const shift = await ownShift(userId, context, shiftId);
            if (!shift) throw new Error(`Unknown shiftId ${shiftId} — use an id from SCHEDULE or find_shifts`);
            // They worked it, so it happened: the hours and the shift stay together
            if (shift.timeEntries.length > 0) throw new Error(`The shift ${shiftId} has hours added, so it was worked and can’t be removed here — offer to open it (open_shift)`);
            shifts.push(shift);
        }
        return { type: 'removeShifts', shiftIds: shifts.map((shift) => shift.id), preview: { shifts: shifts.map((shift) => ({ ...jobCard(shift.job), startTime: shift.startTime, endTime: shift.endTime, missed: Boolean(shift.missedReason) })) } };
    }

    const shift = await ownShift(userId, context, proposal.shiftId);
    if (!shift) throw new Error(`Unknown shiftId ${proposal.shiftId} — use an id from SCHEDULE or find_shifts`);
    const shiftPreview = { ...jobCard(shift.job), startTime: shift.startTime, endTime: shift.endTime };

    if (proposal.type === 'editShift') {
        const job = context.jobs.find((item) => item.id === proposal.jobId);
        if (!job) throw new Error(`Unknown jobId ${proposal.jobId} — use an id from JOBS`);
        const unchanged = job.id === shift.job.id && proposal.startTime.getTime() === shift.startTime.getTime() && proposal.endTime.getTime() === shift.endTime.getTime();
        if (unchanged) throw new Error('That is already the shift’s time — ask what changed');
        const clashes = await prisma.shift.findMany({
            where: { userId, ...NOT_MISSED, id: { not: shift.id }, startTime: { lt: proposal.endTime }, endTime: { gt: proposal.startTime } },
            select: { startTime: true, endTime: true, job: { select: jobFields } },
        });
        return {
            ...proposal,
            // The card shows the clash; a yes means "change it anyway"
            allowOverlap: clashes.length > 0,
            preview: { before: shiftPreview, after: { ...jobCard(job), startTime: proposal.startTime, endTime: proposal.endTime }, overlaps: clashes.map((item) => ({ ...jobCard(item.job), startTime: item.startTime, endTime: item.endTime })) },
        };
    }

    if (proposal.type === 'markMissed') {
        if (shift.missedReason) throw new Error('That shift is already marked missed');
        if (shift.timeEntries.length > 0) throw new Error('That shift has hours added, so it can’t be marked missed — the hours have to be deleted first');
        return { ...proposal, preview: shiftPreview };
    }

    throw new Error(`No card for ${proposal.type}`);
};

/** Hours on several shifts: each new, or replacing what that shift has (the card shows both). */
const hoursCard = async (userId, context, proposal) => {
    if (new Set(proposal.entries.map((entry) => entry.shiftId)).size !== proposal.entries.length) throw new Error('Each shift once — put one entry per shift');
    const now = new Date();
    const entries = [];
    const previews = [];
    for (const entry of proposal.entries) {
        const shift = await ownShift(userId, context, entry.shiftId);
        if (!shift) throw new Error(`Unknown shiftId ${entry.shiftId} — use an id from SCHEDULE or find_shifts`);
        if (shift.missedReason) throw new Error(`The shift ${shift.id} is marked missed, so it can’t get hours — undo "missed" first`);
        if (entry.clockOut > now) throw new Error('Hours can’t end in the future');
        const existing = shift.timeEntries[0] ?? null;
        const breakMinutes = entry.breakMinutes ?? autoBreakMinutes(entry.clockIn, entry.clockOut);
        const paid = Math.max(0, Math.round((entry.clockOut - entry.clockIn) / 60000) - breakMinutes);
        entries.push({ shiftId: shift.id, entryId: existing?.id ?? null, clockIn: entry.clockIn, clockOut: entry.clockOut, breakMinutes });
        previews.push({
            ...jobCard(shift.job),
            startTime: shift.startTime,
            endTime: shift.endTime,
            clockIn: entry.clockIn,
            clockOut: entry.clockOut,
            breakMinutes,
            paidMinutes: paid,
            before: existing
                ? { clockIn: existing.clockIn, clockOut: existing.clockOut, breakMinutes: existing.breakMinutes, paidMinutes: existing.clockOut ? Math.max(0, Math.round((existing.clockOut - existing.clockIn) / 60000) - existing.breakMinutes) : null }
                : null,
        });
    }
    return { type: 'logHours', entries, preview: { entries: previews } };
};

/** Only the job details the model gave: an edit changes what was said and nothing else. */
const jobDetailsFrom = ({ companyName, title, hourlyRate }) => ({
    ...(companyName !== undefined && { companyName }),
    ...(title !== undefined && { title }),
    ...(hourlyRate !== undefined && { hourlyRate }),
});

/** A tool call's arguments → a proposal, in UTC on the person's calendar. */
const proposalFromCall = async (userId, call, context, timeZone) => {
    const { args } = call;
    if (call.name === 'add_shifts') {
        const shifts = (args.shifts ?? []).map((shift) => {
            const span = spanOn(shift.date, shift.start, shift.end, timeZone);
            if (!span) throw new Error(`Couldn’t read ${shift.date} ${shift.start}–${shift.end}; use YYYY-MM-DD and HH:mm`);
            return { jobId: shift.jobId, ...span, notes: shift.notes?.trim() || null };
        });
        if (shifts.length === 0) throw new Error('No shifts given');
        return { type: 'addShifts', shifts };
    }
    if (call.name === 'mark_missed') return { type: 'markMissed', shiftId: args.shiftId, reason: args.reason };
    if (call.name === 'remove_shifts') {
        if (!args.shiftIds?.length) throw new Error('No shifts given');
        return { type: 'removeShifts', shiftIds: args.shiftIds };
    }
    if (call.name === 'log_hours') {
        if (!args.entries?.length) throw new Error('No hours given');
        const entries = [];
        for (const item of args.entries) {
            const shift = await ownShift(userId, context, item.shiftId);
            if (!shift) throw new Error(`Unknown shiftId ${item.shiftId} — use an id from SCHEDULE or find_shifts`);
            // Hours are on the shift's own day, so "9 to 5:30" needs no date from the model
            const day = DateTime.fromJSDate(shift.startTime, { zone: timeZone }).toISODate();
            const clockIn = item.start ? localToDate(day, item.start, timeZone) : shift.startTime;
            if (!clockIn) throw new Error(`Couldn’t read the clock-in ${item.start}; use HH:mm`);
            if (item.paidMinutes) {
                entries.push({ shiftId: shift.id, clockIn, ...clockOutForPaid(clockIn, item.paidMinutes, item.breakMinutes) });
                continue;
            }
            if (!item.end) throw new Error('Give each entry an end time or paidMinutes');
            const span = spanOn(day, DateTime.fromJSDate(clockIn, { zone: timeZone }).toFormat('HH:mm'), item.end, timeZone);
            if (!span) throw new Error(`Couldn’t read the clock-out ${item.end}; use HH:mm`);
            entries.push({ shiftId: shift.id, clockIn: span.startTime, clockOut: span.endTime, ...(item.breakMinutes != null && { breakMinutes: item.breakMinutes }) });
        }
        return { type: 'logHours', entries };
    }
    if (call.name === 'add_job') return { type: 'addJob', job: jobDetailsFrom(args) };
    if (call.name === 'edit_job') return { type: 'editJob', jobId: args.jobId, changes: jobDetailsFrom(args) };
    if (call.name === 'delete_job') return { type: 'deleteJob', jobId: args.jobId };

    const shift = await ownShift(userId, context, args.shiftId);
    if (!shift) throw new Error(`Unknown shiftId ${args.shiftId} — use an id from SCHEDULE or find_shifts`);
    const own = (date) => DateTime.fromJSDate(date, { zone: timeZone });

    // edit_shift: only what changed is given; the rest is the shift as it is
    const day = args.date ?? own(shift.startTime).toISODate();
    const start = args.start ?? own(shift.startTime).toFormat('HH:mm');
    const end = args.end ?? own(shift.endTime).toFormat('HH:mm');
    const span = spanOn(day, start, end, timeZone);
    if (!span) throw new Error(`Couldn’t read ${day} ${start}–${end}; use YYYY-MM-DD and HH:mm`);
    return { type: 'editShift', shiftId: shift.id, jobId: args.jobId ?? shift.job.id, ...span };
};

/** find_shifts: their shifts between two days, as the same lines the prompt uses. */
const findShifts = async (userId, context, { from, to, jobId }, timeZone, now) => {
    const start = DateTime.fromISO(from ?? '', { zone: timeZone });
    const end = DateTime.fromISO(to ?? '', { zone: timeZone });
    if (!start.isValid || !end.isValid || end < start) return { error: 'Give from and to as YYYY-MM-DD, from first' };
    if (end.diff(start, 'days').days > MAX_LOOKUP_DAYS) return { error: `Look up at most ${MAX_LOOKUP_DAYS} days at a time` };

    const shifts = await prisma.shift.findMany({
        where: { userId, ...(jobId && { jobId }), startTime: { gte: start.startOf('day').toJSDate(), lt: end.startOf('day').plus({ days: 1 }).toJSDate() } },
        select: shiftFields,
        orderBy: { startTime: 'asc' },
        take: MAX_LOOKUP_SHIFTS,
    });
    shifts.forEach((shift) => context.shiftsById.set(shift.id, shift));
    return { shifts: shifts.map((shift) => describeShift(shift, timeZone, now)) };
};

/** find_conflicts: their overlapping shifts from now on, each pair as two schedule lines. */
const findClashes = async (userId, context, timeZone, now) => {
    const { overlaps: pairs } = await findConflicts(userId);
    const lines = pairs.slice(0, MAX_LOOKUP_SHIFTS).map(({ first, second }) => {
        context.shiftsById.set(first.id, first);
        context.shiftsById.set(second.id, second);
        return `${describeShift(first, timeZone, now)}  OVERLAPS  ${describeShift(second, timeZone, now)}`;
    });
    return { overlaps: lines.length ? lines : 'none — no shifts overlap' };
};

/**
 * Saves a confirmed proposal through the same services and rules as the app's
 * own forms. Returns what changed, so the app can refresh and say it. A change or a
 * removal also returns `undo`: the proposal that puts it back, sent to /assistant/confirm.
 */
const applyProposal = async (userId, proposal) => {
    if (proposal.type === 'addJob') {
        const checked = createJobSchema.safeParse(proposal.job);
        if (!checked.success) throw new ApiError(400, checked.error.issues[0].message);
        const job = await jobService.createJob(userId, checked.data);
        return { type: 'addJob', count: 1, shiftIds: [], skipped: 0, jobId: job.id, undo: { type: 'deleteJob', jobId: job.id } };
    }
    if (proposal.type === 'editJob') {
        const before = await jobService.getJobById(userId, proposal.jobId);
        const checked = updateJobSchema.safeParse(proposal.changes);
        if (!checked.success) throw new ApiError(400, checked.error.issues[0].message);
        await jobService.updateJob(userId, proposal.jobId, checked.data);
        // Undo sets back only what this changed
        const previous = Object.fromEntries(Object.keys(checked.data).map((field) => [field, before[field]]));
        return { type: 'editJob', count: 1, shiftIds: [], skipped: 0, jobId: proposal.jobId, undo: { type: 'editJob', jobId: proposal.jobId, changes: previous } };
    }
    if (proposal.type === 'deleteJob') {
        // Its upcoming shifts go with it (job.service); Undo brings them back
        const upcoming = await prisma.shift.findMany({ where: { userId, jobId: proposal.jobId, startTime: { gt: new Date() } }, select: { startTime: true, endTime: true, notes: true } });
        await jobService.deleteJob(userId, proposal.jobId);
        return { type: 'deleteJob', count: 1, shiftIds: [], skipped: 0, jobId: proposal.jobId, undo: { type: 'restoreJob', jobId: proposal.jobId, shifts: upcoming } };
    }
    if (proposal.type === 'restoreJob') {
        const job = await prisma.job.findFirst({ where: { id: proposal.jobId, userId }, select: { id: true } });
        if (!job) throw new ApiError(404, 'Job not found');
        await prisma.job.update({ where: { id: job.id, userId }, data: { isActive: true } });
        const { created } = proposal.shifts.length ? await shiftService.createShiftsBulk(userId, proposal.shifts.map((shift) => ({ jobId: job.id, ...shift }))) : { created: [] };
        return { type: 'restoreJob', count: 1, shiftIds: created.map((shift) => shift.id), skipped: proposal.shifts.length - created.length, jobId: job.id };
    }
    if (proposal.type === 'addShifts') {
        const shifts = proposal.shifts.map((shift) => {
            const checked = createShiftSchema.safeParse(shift);
            if (!checked.success) throw new ApiError(400, checked.error.issues[0].message);
            return checked.data;
        });
        if (shifts.length === 1) {
            const created = await shiftService.createShift(userId, { ...shifts[0], allowOverlap: proposal.allowOverlap });
            return { type: 'addShifts', count: 1, shiftIds: [created.id], skipped: 0 };
        }
        const { created, skipped } = await shiftService.createShiftsBulk(userId, shifts);
        return { type: 'addShifts', count: created.length, shiftIds: created.map((shift) => shift.id), skipped: skipped.length };
    }
    if (proposal.type === 'editShift') {
        const before = await prisma.shift.findFirst({ where: { id: proposal.shiftId, userId }, select: { jobId: true, startTime: true, endTime: true } });
        if (!before) throw new ApiError(404, 'Shift not found');
        const checked = updateShiftSchema.safeParse({ jobId: proposal.jobId, startTime: proposal.startTime, endTime: proposal.endTime });
        if (!checked.success) throw new ApiError(400, checked.error.issues[0].message);
        await shiftService.updateShift(userId, proposal.shiftId, { ...checked.data, allowOverlap: proposal.allowOverlap });
        // Undo puts back exactly what was there, even if something now sits in its old place
        return { type: 'editShift', count: 1, shiftIds: [proposal.shiftId], skipped: 0, undo: { type: 'editShift', shiftId: proposal.shiftId, ...before, allowOverlap: true } };
    }
    if (proposal.type === 'removeShifts') {
        const shifts = await prisma.shift.findMany({ where: { id: { in: proposal.shiftIds }, userId }, select: { jobId: true, startTime: true, endTime: true, notes: true, _count: { select: { timeEntries: true } } } });
        if (shifts.length !== proposal.shiftIds.length) throw new ApiError(404, 'Shift not found');
        if (shifts.some((shift) => shift._count.timeEntries > 0)) throw new ApiError(409, 'A shift with hours added can’t be removed here — open it to change it');
        await shiftService.deleteShifts(userId, proposal.shiftIds);
        return {
            type: 'removeShifts',
            count: shifts.length,
            shiftIds: proposal.shiftIds,
            skipped: 0,
            undo: { type: 'addShifts', shifts: shifts.map(({ jobId, startTime, endTime, notes }) => ({ jobId, startTime, endTime, notes })), allowOverlap: true },
        };
    }
    if (proposal.type === 'markMissed') {
        await shiftService.markMissed(userId, proposal.shiftId, { reason: proposal.reason });
        return { type: 'markMissed', count: 1, shiftIds: [proposal.shiftId], skipped: 0 };
    }
    if (proposal.type === 'logHours') {
        const created = [];
        const restore = [];
        for (const entry of proposal.entries) {
            const hours = { clockIn: entry.clockIn, clockOut: entry.clockOut, breakMinutes: entry.breakMinutes ?? autoBreakMinutes(entry.clockIn, entry.clockOut) };
            if (entry.entryId) {
                const before = await timesheetService.getEntry(userId, entry.entryId);
                await timesheetService.updateEntry(userId, entry.entryId, hours);
                restore.push({ entryId: entry.entryId, clockIn: before.clockIn, clockOut: before.clockOut, breakMinutes: before.breakMinutes });
            } else {
                created.push((await timesheetService.createEntry(userId, { shiftId: entry.shiftId, ...hours })).id);
            }
        }
        const shiftIds = proposal.entries.map((entry) => entry.shiftId);
        return { type: 'logHours', count: shiftIds.length, shiftIds, skipped: 0, undo: { type: 'undoHours', remove: created, restore } };
    }
    if (proposal.type === 'undoHours') {
        for (const entryId of proposal.remove) await timesheetService.deleteEntry(userId, entryId);
        for (const { entryId, ...hours } of proposal.restore) await timesheetService.updateEntry(userId, entryId, hours);
        return { type: 'undoHours', count: proposal.remove.length + proposal.restore.length, shiftIds: [], skipped: 0 };
    }
    throw new ApiError(400, `Unknown change ${proposal.type}`);
};

/** The card's Save button: no model call, just the save. */
const confirmProposal = (userId, proposal) => applyProposal(userId, proposal);

/** Voice "yes": save, and answer in words. A refusal (a new clash, hours since added) is said, and the card stays. */
const confirmByVoice = async (userId, context, pending, replyFor) => {
    try {
        const saved = await applyProposal(userId, pending);
        return { reply: replyFor(saved), pending: null, saved };
    } catch (err) {
        if (!(err instanceof ApiError) || err.statusCode >= 500) throw err;
        return { reply: err.message, pending: await cardFor(userId, context, pending).catch(() => null), saved: null };
    }
};

/** add_shifts … delete_job: put the change on a card. Nothing is saved until a yes. */
const change = async (args, turn, name) => {
    const proposal = await proposalFromCall(turn.userId, { name, args }, turn.context, turn.timeZone);
    const card = await cardFor(turn.userId, turn.context, proposal, { checkClash: name === 'add_shifts' && !args.extraShift, changeSameJob: name === 'add_shifts' });
    // The model asked to add; code made it a change, so the model's words don't fit
    const becameChange = name === 'add_shifts' && card.type === 'editShift';
    const clash = card.allowOverlap && card.preview.overlaps[0];
    const say = clash ? clashText(turn.message, clash, turn.timeZone) : becameChange ? changeText(turn.message, card.preview.after, turn.timeZone) : undefined;
    return { card, say };
};

/**
 * Tool name → what it does, like the `available_tools` map of a plain agent loop.
 * `observe` goes back to the model (a lookup, a mistake); anything else ends the turn:
 * a `card` waiting for a yes, something `saved` (confirm_pending), an `action` for the app, or words to `say`.
 */
const TOOLS = {
    find_shifts: async (args, turn) => ({ observe: await findShifts(turn.userId, turn.context, args, turn.timeZone, turn.now) }),
    find_conflicts: async (args, turn) => ({ observe: await findClashes(turn.userId, turn.context, turn.timeZone, turn.now) }),
    add_shifts: change,
    edit_shift: change,
    remove_shifts: change,
    mark_missed: change,
    log_hours: change,
    add_job: change,
    edit_job: change,
    delete_job: change,
    confirm_pending: async (args, turn) => {
        if (!turn.pending) throw new Error('Nothing is waiting to be confirmed');
        if (!saysYes(turn.message)) throw new Error('They did not say yes — answer what they said, and propose the change again only if they still want it');
        const outcome = await confirmByVoice(turn.userId, turn.context, turn.pending, () => args.reply);
        // Not saved: the reason is said instead of the model's "done"
        if (!outcome.saved) return { card: outcome.pending, say: { reply: outcome.reply, speech: null } };
        // Nothing new (all of them were there already): said as that, not as the model's "added"
        const nothingNew = outcome.saved.type === 'addShifts' && outcome.saved.count === 0;
        return { card: null, saved: outcome.saved, say: nothingNew ? { reply: quickReplyText(turn.message, outcome.saved), speech: quickReplySpeech(turn.message, outcome.saved) } : undefined };
    },
    cancel_pending: async () => ({ card: null }),
    open_page: async (args) => ({ action: { type: 'openPage', page: args.page } }),
    open_shift: async (args, turn) => {
        if (!(await ownShift(turn.userId, turn.context, args.shiftId))) throw new Error(`Unknown shiftId ${args.shiftId}`);
        return { action: { type: 'openShift', shiftId: args.shiftId } };
    },
    open_panel: async (args) => ({ action: { type: 'openPanel', panel: args.panel } }),
    close_panels: async () => ({ action: { type: 'closePanels' } }),
    // A question about the waiting card keeps it (checked again: it may no longer fit); anything else lets it go
    answer: async (args, turn) => (args.keepCard && turn.pending ? { card: await cardFor(turn.userId, turn.context, turn.pending).catch(() => null) } : {}),
};

// The model sometimes copies the Roman reply into speech; that isn't a copy a Hindi voice can read
const devanagariOnly = (speech) => (speech && languageOf(speech) === 'hindi' ? speech : null);

/**
 * The turn's words: the reply, and the Devanagari copy only when every part has one
 * (else the voice reads the reply). Two tool calls with the same reply say it once.
 */
const wordsOf = (allParts) => {
    const parts = allParts.filter((part, index) => allParts.findIndex((other) => other.reply === part.reply) === index);
    return {
        reply: parts.map((part) => part.reply).join(' ') || 'Done.',
        speech: parts.length > 0 && parts.every((part) => part.speech) ? parts.map((part) => part.speech).join(' ') : null,
    };
};

/**
 * One turn of the conversation. Answers with what to say (`speech`: how a Hindi
 * voice should say it), the card now waiting (or null), what to open in the app,
 * and what was saved. A plain "yes"/"no" to a waiting card skips the model;
 * everything else is one to MAX_ASSISTANT_STEPS model calls (look up, then act).
 */
const respond = async (userId, { message, history, pending, page, timeZone }) => {
    const now = new Date();
    const context = await loadContext(userId, now, timeZone);
    const keepPending = async () => (pending ? cardFor(userId, context, pending).catch(() => null) : null);

    if (pending) {
        const answer = quickAnswer(message);
        if (answer === 'yes') {
            const outcome = await confirmByVoice(userId, context, pending, (saved) => quickReplyText(message, saved));
            return { ...outcome, speech: outcome.saved ? quickReplySpeech(message, outcome.saved) : null, actions: [] };
        }
        if (answer === 'no') return { reply: quickReplyText(message, 'cancelled'), speech: quickReplySpeech(message, 'cancelled'), pending: null, actions: [], saved: null };
        // A pending card may be about shifts outside the prompt's stretch
        const shiftIds = pending.type === 'removeShifts' ? pending.shiftIds : pending.shiftId ? [pending.shiftId] : [];
        for (const shiftId of shiftIds) await ownShift(userId, context, shiftId);
    }

    const turn = { userId, context, timeZone, now, message, pending };
    const request = {
        contents: [...history.map((line) => ({ role: line.role === 'assistant' ? 'model' : 'user', parts: [{ text: line.text }] })), { role: 'user', parts: [{ text: message }] }],
        config: {
            systemInstruction: buildSystemPrompt({
                name: context.user.name,
                now,
                timeZone,
                page,
                jobs: context.jobs,
                shifts: context.shifts,
                pendingText: describeProposal(pending, context, timeZone),
                features: context.features,
            }),
            tools: [{ functionDeclarations: assistantTools(context.features) }],
            // Always a tool call, plain answers included (`answer`): every reply then carries its `speech`
            toolConfig: { functionCallingConfig: { mode: 'ANY' } },
            temperature: 0.2,
            // A little thinking resolves "parso" and "next Friday" right; more only adds seconds
            thinkingConfig: { thinkingLevel: 'low' },
        },
    };

    // Every step and every model of this turn shares one budget
    const deadline = Date.now() + ASSISTANT_TURN_BUDGET_MS;
    for (let step = 0; step < MAX_ASSISTANT_STEPS; step++) {
        const response = await generateWithFallback(request, { ...GEMINI_MESSAGES, deadline });
        const calls = response.functionCalls ?? [];
        if (calls.length === 0) {
            return { reply: response.text?.trim() || 'Sorry, I didn’t catch that — say it again?', speech: null, pending: null, actions: [], saved: null };
        }

        // The model's own turn goes back as it came (newer models sign their tool calls)
        request.contents.push(response.candidates[0].content);
        const parts = [];
        const actions = [];
        const observations = [];
        let card;
        let saved = null;
        let ended = false;

        for (const call of calls) {
            const args = call.args ?? {};
            try {
                const run = TOOLS[call.name];
                if (!run) throw new Error(`There is no tool called ${call.name}`);
                const result = await run(args, turn, call.name);
                if ('observe' in result) {
                    observations.push({ call, response: result.observe });
                    continue;
                }
                ended = true;
                const say = result.say ?? { reply: args.reply, speech: args.speech };
                if (say.reply) parts.push({ reply: say.reply, speech: devanagariOnly(say.speech) });
                if (result.action) actions.push(result.action);
                if (result.card !== undefined) card = result.card;
                if (result.saved) saved = result.saved;
            } catch (err) {
                if (err instanceof ApiError) throw err;
                // Tell the model what was wrong; it corrects itself or asks the person
                observations.push({ call, response: { error: err.message } });
            }
        }

        // Only lookups and mistakes go back to the model; anything else ends the turn
        if (ended || observations.length === 0) {
            // A card that wasn't proposed again goes: an old card never sits under a new answer
            return { ...wordsOf(parts), pending: card ?? null, actions, saved };
        }
        request.contents.push({ role: 'user', parts: observations.map(({ call, response: result }) => ({ functionResponse: { id: call.id, name: call.name, response: result } })) });
    }

    return { reply: 'Sorry, I got lost there — could you say that again more simply?', speech: null, pending: await keepPending(), actions: [], saved: null };
};

// The names Gemini reads. A phone's .m4a must go as audio/m4a: sent as audio/mp4 it hung for 30 s (tried 2026-10-27).
const GEMINI_AUDIO_TYPE = { 'audio/mp4': 'audio/m4a', 'audio/x-m4a': 'audio/m4a', 'audio/x-wav': 'audio/wav', 'audio/mpeg': 'audio/mp3' };

// The script carries the language to the assistant, which answers in the same one: there is
// no language switch in the apps, so English, Hinglish and Hindi must come out distinct
const TRANSCRIBE_PROMPT = `Write down exactly what the speaker says in this recording. They talk about their work shifts in English, Hindi, or a mix of both (Hinglish).
- English: in English.
- Hinglish (Hindi mixed with English words or sentences): Roman letters, the way people text ("kal meri shift hai", "nahi ja paunga").
- Only Hindi, with English at most for words like shift or job: Devanagari ("कल मेरी शिफ्ट है").
- Numbers and times as digits ("9 se 5", "5:30").
- No translation, no answer, no notes. If nothing clear is said, return an empty text.`;

/** The words in a recording, Hinglish in Roman letters. Nothing is kept: the audio exists only for this call. */
const transcribe = async (audio, mimeType) => {
    let response;
    try {
        response = await generateWithFallback(
            {
                contents: [{ role: 'user', parts: [{ text: TRANSCRIBE_PROMPT }, { inlineData: { data: audio.toString('base64'), mimeType: GEMINI_AUDIO_TYPE[mimeType] ?? mimeType } }] }],
                config: { responseMimeType: 'application/json', responseSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, temperature: 0, thinkingConfig: { thinkingLevel: 'low' } },
            },
            // Audio takes longer than text: a few seconds of speech timed out at 9 s
            { ...GEMINI_MESSAGES, label: 'Assistant voice', timeoutMs: 15000, deadline: Date.now() + TRANSCRIBE_BUDGET_MS }
        );
    } catch (err) {
        // A recording Gemini can't read (a tap with no sound, a broken file) is "didn't catch that", not a failure;
        // busy and out-of-quota (503) still say so
        if (err instanceof ApiError && err.statusCode === 502) return '';
        throw err;
    }
    try {
        return String(JSON.parse(response.text).text ?? '').trim();
    } catch {
        return '';
    }
};

/** POST /assistant/transcribe: only the words, so the web app can show them and then send them as a normal turn. */
const transcribeRecording = async ({ audio, mimeType }) => ({ heard: (await transcribe(audio, mimeType)).slice(0, MAX_ASSISTANT_MESSAGE) });

/**
 * A spoken turn from the phone app, which can't turn speech into text itself (Expo Go
 * has no speech recognition). `heard` is what was understood; when it's empty nothing
 * else is sent and the app keeps its card and asks again.
 */
const respondToVoice = async (userId, { audio, mimeType, ...turn }) => {
    const heard = (await transcribe(audio, mimeType)).slice(0, MAX_ASSISTANT_MESSAGE);
    if (!heard) return { heard: '' };
    return { heard, ...(await respond(userId, { ...turn, message: heard })) };
};

module.exports = { respond, respondToVoice, transcribeRecording, confirmProposal };
