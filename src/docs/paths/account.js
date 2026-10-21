const a = require('../../validation/account.validation');
const { op, ok, errors, error, pathParam } = require('../helpers');

const tag = 'Account';

const session = {
    type: 'object',
    properties: {
        id: { type: 'string', format: 'uuid' },
        device: {
            type: 'object',
            properties: {
                kind: { type: 'string', enum: ['browser', 'app', 'unknown'] },
                name: { type: 'string', example: 'Chrome on Windows' },
            },
        },
        isCurrent: { type: 'boolean', description: 'The device making this request' },
        createdAt: { type: 'string', format: 'date-time', description: 'When it signed in' },
        lastUsedAt: { type: 'string', format: 'date-time', description: 'Last token refresh — roughly the last time it was used' },
    },
};

module.exports = {
    '/account/sessions': {
        get: op({
            tag,
            summary: 'Where you’re signed in',
            description:
                'Every device and browser with a live session, this one first, then by last use. `device.name` is made ' +
                'from the user agent on the server (`domain/account.js`), so every client words it the same.',
            responses: { ...ok('Signed-in devices', { type: 'array', items: session }) },
        }),
        delete: op({
            tag,
            summary: 'Sign out every other device',
            description: 'Ends every session except the one making the request. For after signing in on a shared computer, or when something looks off.',
            responses: { ...ok('How many were signed out', { type: 'object', properties: { signedOut: { type: 'integer' } } }) },
        }),
    },
    '/account/sessions/{sessionId}': {
        delete: op({
            tag,
            params: [pathParam('sessionId', 'A session from GET /account/sessions')],
            summary: 'Sign out one other device',
            description:
                'That device’s refresh token stops working at once; its access token runs out within 15 minutes. ' +
                'The current device answers 400 `CURRENT_SESSION` — it signs out with POST /auth/logout.',
            responses: { ...ok('Signed out'), ...errors.validation, ...error(404, 'Already signed out, or not yours') },
        }),
    },
    '/account/summary': {
        get: op({
            tag,
            summary: 'How much is in the account',
            description: 'Counts of jobs, shifts, hour entries and active shares, and the deletion grace period in days — shown before someone deletes the account.',
            responses: {
                ...ok('Counts', {
                    type: 'object',
                    properties: {
                        jobs: { type: 'integer' },
                        shifts: { type: 'integer' },
                        timeEntries: { type: 'integer' },
                        shares: { type: 'integer' },
                        graceDays: { type: 'integer', example: 30 },
                    },
                }),
            },
        }),
    },
    '/account/export': {
        get: op({
            tag,
            summary: 'Download a copy of your data',
            description:
                'Profile, jobs, shifts, hours worked and sharing, as one JSON document (times in UTC). Password and token hashes and ' +
                'one-time codes are never included. Sent with `Cache-Control: no-store`. Limited to 10 an hour.',
            responses: { ...ok('Everything in the account', { type: 'object' }), ...errors.rateLimited },
        }),
    },
    '/account/deletion': {
        post: op({
            tag,
            body: a.accountDeletionSchema,
            summary: 'Delete the account (30 days to change your mind)',
            description:
                'A password account sends `password` (401 `WRONG_PASSWORD`, 400 `PASSWORD_REQUIRED`); a Google/Apple account sends ' +
                '`confirm: "DELETE"` (400 `CONFIRMATION_REQUIRED`). The account is then signed out everywhere and hidden at once — shares ' +
                'stop showing, sign-in answers 403 `ACCOUNT_PENDING_DELETION` with a restore offer — and an email says when it goes. ' +
                '30 days later it is erased with everything in it (database cascade). Returns `purgeAt`.',
            responses: {
                ...ok('Deletion scheduled', { type: 'object', properties: { purgeAt: { type: 'string', format: 'date-time' } } }),
                ...errors.validation,
                ...error(401, 'Wrong password (WRONG_PASSWORD), or not signed in'),
                ...errors.rateLimited,
            },
        }),
    },
};
