const { z } = require('zod');
const { uuid, timeZone } = require('./common.validation');

// Same list as domain/timesheet.js SUMMARY_RANGES (validation imports only zod/luxon)
const SUMMARY_RANGES = ['week', 'twoWeeks', 'month', 'all'];

const MAX_BREAK_MINUTES = 240;

// POST /timesheet/clock-in — always for a scheduled shift (hours without one are added by hand)
const clockInSchema = z.object({ shiftId: uuid('Invalid shift ID') });

// POST /timesheet — an entry typed in afterwards
const createEntrySchema = z
    .object({
        // The scheduled shift these hours are for — or, for work that wasn't scheduled, just the job
        shiftId: uuid('Invalid shift ID').optional(),
        jobId: uuid('Invalid job ID').optional(),
        clockIn: z.coerce.date({ error: 'Clock-in time is required' }),
        clockOut: z.coerce.date({ error: 'Clock-out time is required' }),
        breakMinutes: z.number().int().min(0).max(MAX_BREAK_MINUTES).optional(),
    })
    .refine((body) => body.shiftId !== undefined || body.jobId !== undefined, 'Send a shiftId or a jobId');

// PATCH /timesheet/:entryId — clockOut null puts the entry back on the clock
const updateEntrySchema = z
    .object({
        clockIn: z.coerce.date().optional(),
        clockOut: z.coerce.date().nullable().optional(),
        breakMinutes: z.number().int().min(0).max(MAX_BREAK_MINUTES).optional(),
    })
    .refine((body) => Object.keys(body).length > 0, 'Nothing to change');

// GET /timesheet?jobId=&offset=&timeZone=
const timesheetQuerySchema = z.object({
    jobId: uuid('Invalid job ID'),
    offset: z.coerce.number().int().min(-104).max(4).default(0).describe('0 = the pay period today is in, -1 = the one before'),
    timeZone: timeZone(),
});

// GET /timesheet/week?offset=&timeZone= — all jobs, one calendar week
const weekQuerySchema = z.object({
    offset: z.coerce.number().int().min(-104).max(4).default(0).describe('0 = this week, -1 = last week'),
    timeZone: timeZone(),
});

// GET /timesheet/summary?range=&offset=&timeZone= — every job's hours and pay for a stretch of time
const summaryQuerySchema = z.object({
    range: z.enum(SUMMARY_RANGES).default('week').describe('week (Sun–Sat), twoWeeks (this week and last), month (calendar month) or all (everything)'),
    offset: z.coerce.number().int().min(-520).max(0).default(0).describe('0 = the range today is in, -1 = the one before; ignored for all'),
    timeZone: timeZone(),
});

// GET /timesheet/statement — the same stretches as the summary (not all time), or one job's pay period
const statementQuerySchema = z.object({
    jobId: uuid('Invalid job ID').optional().describe('One job by its pay period; without it, every job for `range`'),
    range: z.enum(SUMMARY_RANGES.filter((range) => range !== 'all')).default('week').describe('week (Sun–Sat), twoWeeks (this week and last) or month; ignored with jobId'),
    offset: z.coerce.number().int().min(-520).max(0).default(0).describe('0 = the period today is in, -1 = the one before'),
    timeZone: timeZone(),
});

module.exports = { statementQuerySchema, createEntrySchema, summaryQuerySchema, weekQuerySchema, clockInSchema, updateEntrySchema, timesheetQuerySchema };
