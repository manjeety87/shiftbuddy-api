const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const { NOT_MISSED } = require('../constants/shifts');
const { resolveFeatures } = require('../domain/features');
const { jobName } = require('../domain/jobLabels');
const { buildStatement, statementSpan } = require('../domain/statement');
const { renderStatementPdf } = require('../pdf/statementPdf');

// The shift statement: every shift worked in a stretch of days, as a PDF to keep
// or send. Only what the statement prints is read — no ids, notes, places or emails.

const JOB_FIELDS = { id: true, title: true, companyName: true, hourlyRate: true };

/**
 * Finished, not-missed shifts starting in the span (each with its closed entry),
 * and hours typed in without a shift. Both use the (userId, start) indexes; a
 * shift's entries come by `time_entries.shiftId`, which has its own index.
 */
const findWorked = (userId, { start, end }, jobId) => {
    const scope = { userId, ...(jobId && { jobId }) };
    const span = { gte: start.toJSDate(), lt: end.toJSDate() };
    const now = new Date();
    return Promise.all([
        prisma.shift.findMany({
            where: { ...scope, ...NOT_MISSED, startTime: span, endTime: { lte: now } },
            select: {
                startTime: true,
                endTime: true,
                job: { select: JOB_FIELDS },
                timeEntries: { where: { clockOut: { not: null } }, select: { clockIn: true, clockOut: true, breakMinutes: true } },
            },
            orderBy: { startTime: 'asc' },
        }),
        prisma.timeEntry.findMany({
            where: { ...scope, shiftId: null, clockIn: span, clockOut: { not: null } },
            select: { clockIn: true, clockOut: true, breakMinutes: true, job: { select: JOB_FIELDS } },
            orderBy: { clockIn: 'asc' },
        }),
    ]);
};

/** The statement PDF for a preset stretch or from–to, for every job or one. */
const getStatement = async (userId, { range, offset, from, to, jobId, timeZone }) => {
    const [user, job] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId }, select: { name: true, taxDeductionPercent: true, features: true } }),
        jobId ? prisma.job.findFirst({ where: { id: jobId, userId }, select: { title: true, companyName: true } }) : null,
    ]);
    if (!user) throw new ApiError(401, 'User no longer exists');
    if (jobId && !job) throw new ApiError(404, 'Job not found');

    const span = statementSpan({ range, offset, from, to }, new Date(), timeZone);
    const [shifts, looseEntries] = await findWorked(userId, span, jobId);
    const statement = buildStatement({ shifts, looseEntries, taxDeductionPercent: user.taxDeductionPercent, showPay: resolveFeatures(user.features).pay });

    const period = { start: span.start.toISODate(), end: span.end.minus({ days: 1 }).toISODate() };
    const pdf = await renderStatementPdf({
        statement,
        personName: user.name,
        scope: job ? [jobName(job), job.companyName?.trim() && job.title].filter(Boolean).join(', ') : 'All jobs',
        period,
        timeZone,
        preparedAt: new Date(),
    });
    return { pdf, filename: `shiftbuddy-statement-${period.start}-to-${period.end}.pdf` };
};

module.exports = { getStatement };
