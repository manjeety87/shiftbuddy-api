const v = require('../../validation/shift.validation');
const { routesQuerySchema } = require('../../validation/commute.validation');
const { op, ok, ref, errors, error, pathParam } = require('../helpers');

const tag = 'Shifts';
const planningTag = 'Getting there';
const shiftId = pathParam('shiftId', 'The shift’s id');
const shiftList = { type: 'array', items: ref('Shift') };
const overlap = error(409, 'Overlaps another shift — `details.code` is SHIFT_OVERLAP and `details.conflicts` lists them. Retry with `allowOverlap: true` to keep it.');

module.exports = {
    '/shifts': {
        post: op({
            tag, body: v.createShiftSchema,
            summary: 'Add a shift',
            description: 'End must be after start (overnight shifts end the next day). Refuses overlaps unless `allowOverlap` is true.',
            responses: { ...ok('Created shift', ref('Shift'), 201), ...errors.validation, ...overlap, ...error(404, 'Job not found (or not yours)') },
        }),
        get: op({
            tag, query: v.shiftFilterQuerySchema,
            summary: 'List my shifts',
            description: 'Oldest first, each with its job. Filter by start time for calendars and lists.',
            responses: { ...ok('Shifts', shiftList), ...errors.validation },
        }),
    },
    '/shifts/bulk': {
        post: op({
            tag, body: v.bulkCreateShiftsSchema,
            summary: 'Add many shifts at once (scan import, Undo)',
            description: 'Up to 100. A shift that would overlap an existing one — or one earlier in the same batch — is skipped, not an error: it is almost always a duplicate.',
            responses: { ...ok('Created and skipped shifts', ref('BulkResult'), 201), ...errors.validation, ...error(404, 'One of the jobs wasn’t found (or isn’t yours)') },
        }),
    },
    '/shifts/copy': {
        post: op({
            tag, body: v.copyShiftsSchema,
            summary: 'Copy shifts onto other days (copy shift / copy week)',
            description:
                'Give `targetDates` (the selection’s first day lands on each date; a multi-day selection keeps its spacing) ' +
                'or `offsetDays` (copy week → 7). Worked out in `timeZone`, so times of day stay the same across DST changes. ' +
                'Copies that clash with existing shifts are skipped. At most 200 copies per request.',
            responses: { ...ok('Created and skipped copies', ref('BulkResult'), 201), ...errors.validation, ...errors.notFound },
        }),
    },
    '/shifts/summary': {
        get: op({
            tag, query: v.shiftFilterQuerySchema,
            summary: 'Hours and estimated pay for a period',
            description: 'Totals and a per-job breakdown. Net pay applies the user’s tax deduction estimate — an estimate, not payroll.',
            responses: { ...ok('Summary', ref('PaySummary')), ...errors.validation },
        }),
    },
    '/shifts/schedule-message': {
        get: op({
            tag, query: v.scheduleMessageQuerySchema,
            summary: 'My schedule as a ready-to-send text message',
            description:
                'For WhatsApp/SMS: "Mon, Oct 5: 9 AM – 5 PM Boathouse · 5:30 – 9 PM Fairweather … Total: 19.5h". ' +
                'Days and times follow `timeZone`; weeks start on Sunday. Names use the workplace unless `nameStyle=job`.',
            responses: { ...ok('The message', ref('ScheduleMessage')), ...errors.validation },
        }),
    },
    '/shifts/conflicts': {
        get: op({
            tag, query: v.travelConflictsQuerySchema,
            summary: 'Every schedule problem: overlaps + travel-time conflicts',
            description:
                'Overlaps from `from` (default now, including a shift in progress). Travel conflicts look at back-to-back shifts ' +
                'at different places in the next 14 days (max 31) and check real transit/driving time. Slower because of routing lookups.',
            responses: { ...ok('Conflicts', ref('Conflicts')), ...errors.validation },
        }),
    },
    '/shifts/travel-conflicts': {
        get: op({
            tag, query: v.travelConflictsQuerySchema,
            summary: 'Only travel-time conflicts',
            description: 'Used by the conflict explanation screen for one pair of shifts. Prefer /shifts/conflicts for lists.',
            responses: { ...ok('Travel conflicts', { type: 'object', properties: { mode: { type: 'string' }, conflicts: { type: 'array', items: ref('TravelConflict') } } }), ...errors.validation },
        }),
    },
    '/shifts/{shiftId}': {
        get: op({ tag, params: [shiftId], summary: 'One shift', description: 'With its job.', responses: { ...ok('The shift', ref('Shift')), ...errors.notFound } }),
        patch: op({
            tag, params: [shiftId], body: v.updateShiftSchema,
            summary: 'Edit a shift',
            description: 'Send only what changes. Moving its times re-checks overlaps (unless `allowOverlap`).',
            responses: { ...ok('Updated shift', ref('Shift')), ...errors.validation, ...overlap, ...errors.notFound },
        }),
        delete: op({
            tag, params: [shiftId],
            summary: 'Delete a shift',
            description: 'Immediate. The app offers Undo by re-creating it through /shifts/bulk.',
            responses: { ...ok('Shift deleted'), ...errors.notFound },
        }),
    },
    '/shifts/{shiftId}/leave-plan': {
        get: op({
            tag: planningTag, params: [shiftId],
            summary: 'When to leave home for this shift',
            description:
                'Uses the user’s home, commute mode and arrival buffer: arrive by = start − buffer, then the latest transit trip ' +
                'or the drive time. `data` is null when there’s no home, no job location or no route.',
            responses: { ...ok('Leave plan (or null)', { ...ref('LeavePlan'), nullable: true }), ...errors.notFound, ...errors.rateLimited },
        }),
    },
    '/shifts/{shiftId}/weather': {
        get: op({
            tag: planningTag, params: [shiftId],
            summary: 'Weather for this shift, and what to wear or bring',
            description:
                'The forecast (Open-Meteo, cached 30 min) where the job is — or at home when the job has no pin — at the shift’s start and ' +
                'end and hour by hour from an hour before to an hour after, plus up to four pieces of advice (rain, snow, ice, cold, heat, ' +
                'wind, a colder trip home). `status` is `unavailable` with a `reason` (NO_LOCATION, SHIFT_OVER, TOO_FAR_AHEAD beyond 16 days, ' +
                'PROVIDER_DOWN) when it can’t be told. Temperatures are °C, wind km/h.',
            responses: { ...ok('Weather, or why there is none', ref('ShiftWeather')), ...errors.notFound, ...errors.rateLimited },
        }),
    },
    '/shifts/{shiftId}/routes': {
        get: op({
            tag: planningTag, params: [shiftId], query: routesQuerySchema,
            summary: 'Driving and transit to this shift, and the way home',
            description:
                'From home, or from `fromLat`/`fromLng` (the phone’s location). Transit: up to 5 distinct routes arriving by the buffer time, ' +
                'each with the first stop and boarding time. If transit is down, driving still comes back (`transit.status = unavailable`).',
            responses: {
                ...ok('Routes', ref('ShiftRoutes')),
                ...errors.validation,
                ...errors.notFound,
                ...error(422, 'Job has no location (`NO_JOB_LOCATION`) or no starting point (`NO_ORIGIN`)'),
                ...errors.rateLimited,
            },
        }),
    },
};
