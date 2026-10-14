const share = require('../../validation/share.validation');
const geocode = require('../../validation/geocode.validation');
const transit = require('../../validation/transit.validation');
const { op, ok, ref, errors, error, pathParam } = require('../helpers');

module.exports = {
    // ── Scanning ────────────────────────────────────────────────────────────
    '/ocr/extract-shifts': {
        post: op({
            tag: 'Scanning',
            summary: 'Read shifts from a photo or screenshot of a schedule',
            description:
                'Paper schedules and other apps’ screenshots. The image is auto-rotated, resized and sent to Google Gemini; ' +
                'if a model is busy the next free model is tried. Nothing is saved — the app shows the result for review, ' +
                'then saves through /shifts/bulk. `employeeName` (defaults to the user’s name) picks the right row on team schedules.',
            multipart: {
                type: 'object',
                required: ['image'],
                properties: {
                    image: { type: 'string', format: 'binary', description: 'JPEG, PNG or WEBP, up to 10 MB' },
                    employeeName: { type: 'string', description: 'Whose shifts to read' },
                    timeZone: { type: 'string', example: 'America/Toronto', description: 'The device’s IANA zone. A schedule shows clock times with no zone; this turns them into real moments. Defaults to America/Toronto.' },
                },
            },
            responses: {
                ...ok('Shifts found', { type: 'object', properties: { shifts: { type: 'array', items: ref('ExtractedShift') } } }),
                ...error(400, 'No image, or not a JPEG/PNG/WEBP'),
                ...error(403, 'Scan limit reached for this plan'),
                ...error(502, 'The image couldn’t be read'),
                ...error(503, 'Every schedule reader is busy — try again in a minute'),
            },
        }),
    },

    // ── Places ──────────────────────────────────────────────────────────────
    '/geocode/search': {
        get: op({
            tag: 'Places', query: geocode.searchQuerySchema,
            summary: 'Find places as you type',
            description:
                'Autocomplete through Photon (OpenStreetMap), ranked around `lat`/`lng` when given. Falls back to Nominatim if Photon is down. ' +
                'Results are cached 10 minutes. 90 requests/min per user.',
            responses: { ...ok('Places', { type: 'array', items: ref('Place') }), ...errors.validation, ...errors.rateLimited, ...errors.upstream },
        }),
    },
    '/geocode/reverse': {
        get: op({
            tag: 'Places', query: geocode.reverseQuerySchema,
            summary: 'The address of a point on the map',
            description: 'For pins dropped by tapping the map. Somewhere with no address (a lake) returns the coordinates as the label.',
            responses: { ...ok('Place', ref('Place')), ...errors.validation, ...errors.rateLimited, ...errors.upstream },
        }),
    },

    // ── Transit ─────────────────────────────────────────────────────────────
    '/transit/plan': {
        get: op({
            tag: 'Getting there', query: transit.planQuerySchema,
            summary: 'Bus/train options between any two points',
            description:
                'Generic planner (used between two jobs on the conflict screen). Open transit data via Transitous: walks up to 25 min to a stop, ' +
                'one entry per distinct route, sorted like a maps app. Cached 10 minutes. For trips to a shift use /shifts/{shiftId}/routes.',
            responses: { ...ok('Itineraries', { type: 'object', properties: { itineraries: { type: 'array', items: ref('TransitItinerary') } } }), ...errors.validation, ...errors.rateLimited, ...errors.upstream },
        }),
    },

    // ── Sharing ─────────────────────────────────────────────────────────────
    '/shares': {
        get: op({
            tag: 'Sharing',
            summary: 'People I share my shifts with',
            description: 'Active and pending shares (expired or stopped ones are left out).',
            responses: { ...ok('Outgoing shares', { type: 'array', items: ref('OutgoingShare') }) },
        }),
        post: op({
            tag: 'Sharing', body: share.createShareSchema,
            summary: 'Share my shifts with someone',
            description:
                'For a week, a month, or until stopped. If the email has no verified account yet the share is pending and attaches ' +
                'once they verify that email. Viewers only see times and workplaces.',
            responses: { ...ok('Share created', ref('OutgoingShare'), 201), ...errors.validation, ...error(400, 'Can’t share with yourself'), ...errors.rateLimited },
        }),
    },
    '/shares/received': {
        get: op({
            tag: 'Sharing',
            summary: 'People sharing their shifts with me',
            description: 'Shown as chips on the Calendar.',
            responses: { ...ok('Incoming shares', { type: 'array', items: ref('IncomingShare') }) },
        }),
    },
    '/shares/{shareId}': {
        delete: op({
            tag: 'Sharing', params: [pathParam('shareId', 'The share’s id')],
            summary: 'Stop sharing, or remove someone’s schedule from my list',
            description: 'Works for both sides: the owner stops sharing, or the viewer removes it.',
            responses: { ...ok('Share ended'), ...errors.notFound },
        }),
    },
    '/shares/{ownerId}/shifts': {
        get: op({
            tag: 'Sharing', params: [pathParam('ownerId', 'Whose schedule')], query: share.sharedShiftsQuerySchema,
            summary: 'Someone else’s shifts (read-only)',
            description:
                'Only while they share with you; otherwise 404 — never 403, so it doesn’t reveal whether the person exists. ' +
                'At most two months per request. No pay, notes or locations.',
            responses: { ...ok('Owner and shifts', { type: 'object', properties: { owner: { type: 'object' }, shifts: { type: 'array', items: ref('SharedShift') } } }), ...errors.validation, ...errors.notFound },
        }),
    },
};
