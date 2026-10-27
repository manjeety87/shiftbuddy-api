const v = require('../../validation/assistant.validation');
const { op, ok, errors, error } = require('../helpers');

const tag = 'Assistant';

const saved = {
    type: 'object',
    description: 'What a confirmed card saved',
    properties: {
        type: { type: 'string', enum: ['addShifts', 'markMissed', 'logHours'] },
        count: { type: 'integer', description: 'Shifts added, or 1' },
        shiftIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
        skipped: { type: 'integer', description: 'Several shifts at once: how many clashed with existing ones and were left out' },
        entryId: { type: 'string', format: 'uuid', description: 'logHours only: the new entry (for Undo)' },
    },
};

const card = {
    type: 'object',
    nullable: true,
    description:
        'The card waiting for a yes: a proposal (send it back unchanged as `pending`, or to /assistant/confirm) plus `preview` — ' +
        'job names, colours and times to draw it, and for added shifts any `overlaps` with shifts already there.',
    additionalProperties: true,
    properties: { type: { type: 'string', enum: ['addShifts', 'markMissed', 'logHours'] }, preview: { type: 'object', additionalProperties: true } },
};

module.exports = {
    '/assistant/messages': {
        post: op({
            tag, body: v.assistantMessageSchema,
            summary: 'Say something to the assistant',
            description:
                'One turn of a conversation, typed or spoken (the browser turns speech into text). Google Gemini reads it with the person’s jobs and ' +
                'their schedule from a week back to two weeks ahead, and answers through tools: add shifts, mark one missed or add hours (each only as a ' +
                'card — nothing is saved until a yes), look up other shifts, and open places in the app. A plain “yes” / “haan” / “no” to the waiting card ' +
                'is answered without the model. The client keeps the conversation (`history`) and the card (`pending`) and sends them back each turn. ' +
                'Replies follow the person’s language: English, Hinglish in Roman letters, or Hindi. 20 turns/min per user.',
            responses: {
                ...ok('The reply', {
                    type: 'object',
                    properties: {
                        reply: { type: 'string', description: 'What to say (and show), in the person’s language' },
                        pending: card,
                        actions: {
                            type: 'array',
                            description: 'What to open in the app, in order',
                            items: {
                                type: 'object',
                                properties: {
                                    type: { type: 'string', enum: ['openPage', 'openShift', 'openPanel', 'closePanels'] },
                                    page: { type: 'string' },
                                    shiftId: { type: 'string', format: 'uuid' },
                                    panel: { type: 'string' },
                                },
                            },
                        },
                        saved: { ...saved, nullable: true },
                    },
                }),
                ...errors.validation,
                ...errors.rateLimited,
                ...error(502, 'The assistant couldn’t answer — try again'),
                ...error(503, 'Every Gemini model is busy — try again in a moment'),
            },
        }),
    },
    '/assistant/confirm': {
        post: op({
            tag, body: v.confirmProposalSchema,
            summary: 'Save the waiting card (its Save button)',
            description:
                'Saves a proposal from /assistant/messages without asking the model. It goes through the same rules as the app’s forms: a shift ' +
                'that now clashes answers 409 SHIFT_OVERLAP (unless the card already showed the clash), a shift with hours can’t be marked missed ' +
                '(409 HAS_HOURS), a shift gets one entry of hours (409 ENTRY_EXISTS).',
            responses: { ...ok('Saved', saved), ...errors.validation, ...errors.notFound, ...error(409, 'It clashes, or the shift changed since the card was made') },
        }),
    },
};
