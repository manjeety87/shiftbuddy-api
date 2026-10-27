const { z } = require('zod');
const { MAX_ASSISTANT_MESSAGE, MAX_ASSISTANT_HISTORY, MAX_HISTORY_TEXT, MAX_PROPOSED_SHIFTS, ASSISTANT_PAGES } = require('../constants/assistant');
const { MISSED_REASONS } = require('../constants/shifts');
const { uuid, timeZone } = require('./common.validation');

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
    z.object({
        type: z.literal('markMissed'),
        shiftId: uuid('Invalid shift ID'),
        reason: z.enum(MISSED_REASONS),
    }),
    z.object({
        type: z.literal('logHours'),
        shiftId: uuid('Invalid shift ID'),
        clockIn: z.coerce.date(),
        clockOut: z.coerce.date(),
        breakMinutes: z.number().int().min(0).max(240).optional(),
    }),
]);

// POST /assistant/messages — one thing the person said or typed, with the conversation so far
const assistantMessageSchema = z.object({
    message: z.string().trim().min(1, 'Say or type something first').max(MAX_ASSISTANT_MESSAGE, 'That’s a bit long — try a shorter request'),
    history: z
        .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(MAX_HISTORY_TEXT) }))
        .max(MAX_ASSISTANT_HISTORY)
        .default([]),
    pending: proposalSchema.nullable().default(null),
    page: z.enum(ASSISTANT_PAGES).optional().describe('The page the person is on'),
    timeZone: timeZone(),
});

// POST /assistant/confirm — the card's Save button
const confirmProposalSchema = z.object({ proposal: proposalSchema });

module.exports = { proposalSchema, assistantMessageSchema, confirmProposalSchema };
