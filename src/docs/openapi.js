const components = require('./components');

// The OpenAPI document for the whole API, served by Swagger UI at /api/docs.
// Paths are split by area; request shapes come from the zod validation schemas.

const spec = {
    openapi: '3.0.3',
    info: {
        title: 'ShiftBuddy API',
        version: '1.0.0',
        description: [
            'Every shift from every job in one place — the backend for the ShiftBuddy app (and the coming web app).',
            '',
            '**Conventions**',
            '- Success: `{ statusCode, data, message, success: true }`. Errors: `{ success: false, message, details? }` — `message` is always safe to show.',
            '- Auth: `Authorization: Bearer <accessToken>`. Click **Authorize** and paste a token from /auth/login to try routes here.',
            '- Times are ISO 8601 (UTC). Where days matter (copying, messages) the client sends its IANA `timeZone`.',
            '- Outside services (Gemini, Transitous, OSRM, Photon, Nominatim) are only called from here, with caching and rate limits.',
        ].join('\n'),
    },
    servers: [{ url: '/api' }],
    security: [{ bearerAuth: [] }],
    tags: [
        { name: 'Auth & profile', description: 'Accounts, sessions, profile and commute settings' },
        { name: 'Account', description: 'Signed-in devices, a copy of your data, deleting the account' },
        { name: 'Jobs', description: 'Workplaces and the role at each' },
        { name: 'Shifts', description: 'Shifts, copying, pay summary, schedule message, conflicts' },
        { name: 'Timesheet', description: 'Clocking in and out, and hours worked per pay period' },
        { name: 'Getting there', description: 'Leave-by times and routes (transit + driving)' },
        { name: 'Scanning', description: 'Reading shifts from photos and screenshots' },
        { name: 'Places', description: 'Address search and map pins' },
        { name: 'Sharing', description: 'Letting someone see your schedule' },
        { name: 'Assistant', description: 'Talking to the app: add shifts, mark missed, add hours and open places, confirmed on a card' },
    ],
    paths: {
        ...require('./paths/auth'),
        ...require('./paths/account'),
        ...require('./paths/jobs'),
        ...require('./paths/shifts'),
        ...require('./paths/timesheet'),
        ...require('./paths/other'),
        ...require('./paths/assistant'),
    },
    components: {
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
        schemas: components,
    },
};

module.exports = spec;
