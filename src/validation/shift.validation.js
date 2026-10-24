const { z } = require('zod');
const { SCHEDULE_RANGES, NAME_STYLES } = require('../constants/scheduleMessage');
const { MAX_SHIFT_HOURS, MAX_NOTES_LENGTH, MAX_BULK_SHIFTS, MISSED_REASONS } = require('../constants/shifts');
const { queryDate, timeZone } = require('./common.validation');

const MAX_SHIFT_MS = MAX_SHIFT_HOURS * 60 * 60 * 1000;

// Empty text and null both mean "no note" — that's how an edit removes one
const notes = () =>
    z.string().trim().max(MAX_NOTES_LENGTH).nullable().optional().transform((value) => (value === '' ? null : value));

/** The two rules every shift's times follow. Skipped while a partial update has only one side (the service checks it against the stored shift). */
const withValidTimes = (schema) =>
    schema
        .refine((shift) => !shift.startTime || !shift.endTime || shift.endTime > shift.startTime, {
            message: 'End time must be after start time',
            path: ['endTime'],
        })
        .refine((shift) => !shift.startTime || !shift.endTime || shift.endTime - shift.startTime <= MAX_SHIFT_MS, {
            message: `A shift can’t be longer than ${MAX_SHIFT_HOURS} hours — check the dates`,
            path: ['endTime'],
        });

const shiftFields = {
    jobId: z.string().uuid('Invalid job ID'),
    startTime: z.coerce.date({ error: 'Start time is required' }),
    endTime: z.coerce.date({ error: 'End time is required' }),
    notes: notes(),
};

const createShiftSchema = withValidTimes(
    z.object({
        ...shiftFields,
        allowOverlap: z.boolean().optional(), // user ne overlap warning dekh ke "Save anyway" chuna
    })
);

const bulkCreateShiftsSchema = z.object({
    shifts: z
        .array(withValidTimes(z.object(shiftFields)))
        .min(1, 'Add at least one shift')
        .max(MAX_BULK_SHIFTS, `You can add up to ${MAX_BULK_SHIFTS} shifts at once`),
});

const updateShiftSchema = withValidTimes(
    z.object({
        jobId: shiftFields.jobId.optional(),
        startTime: z.coerce.date().optional(),
        endTime: z.coerce.date().optional(),
        notes: notes(),
        allowOverlap: z.boolean().optional(),
    })
);

// PUT /shifts/:shiftId/missed — why the user couldn't go, and a note if they want one
const markMissedSchema = z.object({
    reason: z.enum(MISSED_REASONS, { error: `Choose a reason: ${MISSED_REASONS.join(', ')}` }),
    note: notes(),
});

// GET /shifts and /shifts/summary — every filter optional
const shiftFilterQuerySchema = z.object({
    from: queryDate().optional().describe('Only shifts starting at or after this time'),
    to: queryDate().optional().describe('Only shifts starting at or before this time'),
    jobId: z.string().uuid('Invalid job ID').optional().describe('Only this job'),
});

// GET /shifts/travel-conflicts?from=&to= — both optional (defaults: next 14 days)
const travelConflictsQuerySchema = z.object({
    from: queryDate().optional(),
    to: queryDate().optional(),
});

const timeZoneSchema = timeZone();
const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must look like 2026-10-12');
const MAX_COPIES = 200;

// POST /shifts/copy — onto chosen days (targetDates) or moved by a fixed number of days (offsetDays)
const copyShiftsSchema = z
    .object({
        shiftIds: z.array(z.string().uuid('Invalid shift ID')).min(1, 'Pick at least one shift').max(100),
        targetDates: z.array(calendarDateSchema).min(1, 'Pick at least one day').max(31).optional(),
        offsetDays: z.number().int().min(-366).max(366).refine((days) => days !== 0, 'Pick a different day').optional(),
        timeZone: timeZoneSchema,
    })
    .refine((body) => (body.targetDates === undefined) !== (body.offsetDays === undefined), 'Send either targetDates or offsetDays')
    .refine((body) => body.shiftIds.length * (body.targetDates?.length ?? 1) <= MAX_COPIES, `That would create more than ${MAX_COPIES} shifts at once`);

// GET /shifts/schedule-message
const scheduleMessageQuerySchema = z.object({
    range: z.enum(SCHEDULE_RANGES).default('thisWeek'),
    nameStyle: z.enum(NAME_STYLES).default('workplace'),
    includeDaysOff: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
    timeZone: timeZoneSchema,
});

module.exports = {
    shiftFilterQuerySchema,
    copyShiftsSchema,
    scheduleMessageQuerySchema,
    travelConflictsQuerySchema,
    createShiftSchema,
    bulkCreateShiftsSchema,
    updateShiftSchema,
    markMissedSchema,
};