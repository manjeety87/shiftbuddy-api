const { z } = require('zod');
const { MAX_ASSISTANT_MESSAGE, MAX_ASSISTANT_HISTORY, MAX_HISTORY_TEXT, MAX_PROPOSED_SHIFTS, ASSISTANT_PAGES, MAX_KEPT_MESSAGES, MAX_KEPT_TEXT } = require('../constants/assistant');
const { MISSED_REASONS } = require('../constants/shifts');
const { uuid, timeZone } = require('./common.validation');
const { createJobSchema, updateJobSchema } = require('./job.validation');

// What the assistant offers to do and the person confirms (by voice or on the card).
// The client keeps it between turns and sends it back, so it is checked again here;
// saving it then goes through the same schemas and services as the app's own forms.
const proposalSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('addShifts'),
        // "Monday, Wednesday and Friday, 9 to 5" is one request, so one card
        shifts: z
            .array(z.object({ jobId: uuid('Invalid job ID'), startTime: z.coerce.date(), endTime: z.coerce.date(), notes: z.string().trim().max(500).nullable().optional() }))
            .min(1)
            .max(MAX_PROPOSED_SHIFTS),
        // A single shift whose clash the card showed, and the person said yes anyway
        allowOverlap: z.boolean().default(false),
    }),
    // The schedule changed: new times, another day, or another job — the whole shift as it will be
    z.object({
        type: z.literal('editShift'),
        shiftId: uuid('Invalid shift ID'),
        jobId: uuid('Invalid job ID'),
        startTime: z.coerce.date(),
        endTime: z.coerce.date(),
        // The new time clashes, the card showed it, and the person said yes anyway
        allowOverlap: z.boolean().default(false),
    }),
    // No longer on the schedule (rescheduled away, taken off, added by mistake) — not the same as missed
    z.object({
        type: z.literal('removeShifts'),
        shiftIds: z.array(uuid('Invalid shift ID')).min(1).max(MAX_PROPOSED_SHIFTS),
    }),
    z.object({
        type: z.literal('markMissed'),
        shiftId: uuid('Invalid shift ID'),
        reason: z.enum(MISSED_REASONS),
    }),
    // A job the assistant added (saved at once; this comes back only as a card waiting on a clash-free yes)
    z.object({ type: z.literal('addJob'), job: createJobSchema }),
    z.object({ type: z.literal('editJob'), jobId: uuid('Invalid job ID'), changes: updateJobSchema }),
    // Deleting a job always waits for a yes
    z.object({ type: z.literal('deleteJob'), jobId: uuid('Invalid job ID') }),
    // Only as Undo of deleteJob: the job back, with the upcoming shifts that went with it
    z.object({
        type: z.literal('restoreJob'),
        jobId: uuid('Invalid job ID'),
        shifts: z.array(z.object({ startTime: z.coerce.date(), endTime: z.coerce.date(), notes: z.string().max(500).nullable().optional() })).max(500),
    }),
    // Hours on one or more shifts; entryId when it replaces the hours that shift has
    z.object({
        type: z.literal('logHours'),
        entries: z
            .array(
                z.object({
                    shiftId: uuid('Invalid shift ID'),
                    entryId: uuid('Invalid entry ID').nullable().optional(),
                    clockIn: z.coerce.date(),
                    clockOut: z.coerce.date(),
                    breakMinutes: z.number().int().min(0).max(240).optional(),
                })
            )
            .min(1)
            .max(MAX_PROPOSED_SHIFTS),
    }),
    // Only as Undo of logHours: delete the entries it made, put back the ones it changed
    z.object({
        type: z.literal('undoHours'),
        remove: z.array(uuid('Invalid entry ID')).max(MAX_PROPOSED_SHIFTS),
        restore: z
            .array(z.object({ entryId: uuid('Invalid entry ID'), clockIn: z.coerce.date(), clockOut: z.coerce.date().nullable(), breakMinutes: z.number().int().min(0).max(240) }))
            .max(MAX_PROPOSED_SHIFTS),
    }),
]);

const historySchema = z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(MAX_HISTORY_TEXT) }))
    .max(MAX_ASSISTANT_HISTORY)
    .default([]);

// The conversation around one turn, the same whether it was typed or spoken
const turnFields = {
    history: historySchema,
    pending: proposalSchema.nullable().default(null),
    page: z.enum(ASSISTANT_PAGES).optional().describe('The page the person is on'),
    timeZone: timeZone(),
};

// POST /assistant/messages — one thing the person said or typed, with the conversation so far
const assistantMessageSchema = z.object({
    message: z.string().trim().min(1, 'Say or type something first').max(MAX_ASSISTANT_MESSAGE, 'That’s a bit long — try a shorter request'),
    ...turnFields,
});

// A multipart form carries everything as text: history and pending arrive as JSON strings
const jsonField = (schema) =>
    z.preprocess((value, ctx) => {
        if (typeof value !== 'string') return value;
        try {
            return JSON.parse(value);
        } catch {
            ctx.addIssue({ code: 'custom', message: 'history and pending are sent as JSON text' });
            return z.NEVER;
        }
    }, schema);

// POST /assistant/voice — the same turn, as a recording (the phone app can't turn speech into text itself)
const assistantVoiceSchema = z.object({
    history: jsonField(turnFields.history),
    pending: jsonField(turnFields.pending),
    page: turnFields.page,
    timeZone: turnFields.timeZone,
});

// POST /assistant/confirm — the card's Save button
const confirmProposalSchema = z.object({ proposal: proposalSchema });

// PUT /assistant/memory/conversation — the recent conversation as the app shows it.
// `saved` is what a line saved (its Undo is checked again when it is used, by /confirm).
const keptConversationSchema = z.object({
    messages: z
        .array(
            z.object({
                id: z.number().int().nonnegative(),
                role: z.enum(['user', 'assistant']),
                text: z.string().max(MAX_KEPT_TEXT),
                saved: z.record(z.string(), z.unknown()).optional(),
                undone: z.boolean().optional(),
            })
        )
        .max(MAX_KEPT_MESSAGES),
});

const noteParamsSchema = z.object({ noteId: uuid('Invalid note ID') });

module.exports = { proposalSchema, assistantMessageSchema, assistantVoiceSchema, confirmProposalSchema, keptConversationSchema, noteParamsSchema };
