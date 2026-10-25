const v = require('../../validation/shift.validation');
const { leavePlanQuerySchema, routesQuerySchema } = require('../../validation/commute.validation');
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
    '/shifts/statement': {
        get: op({
            tag, query: v.statementQuerySchema,
            summary: 'The shifts worked in a stretch, as a PDF statement',
            description:
                'Like a bank’s e-statement, in plain text: every finished, not-missed shift starting in the stretch (oldest first) with its ' +
                'job, title, start, end, break and hours — clocked hours when the shift has them, else its scheduled times with the usual ' +
                'break — plus hours typed in without a shift; then hours (and pay) by job and a summary. Stretches: `week`, `twoWeeks`, ' +
                '`month`, `threeMonths` (this month and the two before; `offset` steps back), or `custom` with `from`/`to` (at most a year). ' +
                '`jobId` keeps one job. Money only while `features.pay` is on; no ids, notes, places or emails. Answers `application/pdf` ' +
                'as an attachment; errors are JSON as usual. Limited to 60 an hour.',
            responses: {
                200: { description: 'The statement', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } },
                ...errors.validation, ...errors.notFound, ...errors.rateLimited,
            },
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
    '/shifts/{shiftId}/missed': {
        put: op({
            tag, params: [shiftId], body: v.markMissedSchema,
            summary: 'Mark a shift as missed',
            description:
                'The user couldn’t go (SICK, EMERGENCY, TRANSIT, OTHER) or the manager called it off (CALLED_OFF) — before or after the ' +
                'shift. It stays on the schedule but counts for nothing: no pay or hours in the summary, no leave-by, no conflicts, no ' +
                'clock-in, and its time is free for another shift. Marking again changes the reason or note. Refused with 409 HAS_HOURS ' +
                'when the shift has hours on the timesheet.',
            responses: { ...ok('The shift', ref('Shift')), ...errors.validation, ...error(409, 'The shift has hours on the timesheet — `details.code` is HAS_HOURS'), ...errors.notFound },
        }),
        delete: op({
            tag, params: [shiftId],
            summary: 'Undo missed',
            description: 'The shift counts again. Not checked for overlaps — a clash shows up in /shifts/conflicts.',
            responses: { ...ok('The shift', ref('Shift')), ...errors.notFound },
        }),
    },
    '/shifts/{shiftId}/leave-plan': {
        get: op({
            tag: planningTag, params: [shiftId], query: leavePlanQuerySchema,
            summary: 'When to leave for this shift, and from where',
            description:
                'Starts from the job of the user’s shift ending in the 4 hours before this one (they’re already out), otherwise ' +
                'from home — `from` says which, `alternatives` what else can be asked for (`?from=home` answers “what if I came from home?”). ' +
                'Arrive by = start − buffer, then the latest transit trip or the drive time. In the same building as the shift before: ' +
                '`sameBuilding`. When the gap is shorter than the trip: `leavesAsShiftEnds` with `lateMinutes`. `data` is null once ' +
                'the shift has started or is marked missed, or when there’s no starting point, job location or route. Missed shifts are ' +
                'never the starting point.',
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
                'From `fromLat`/`fromLng` (the phone’s location), else by `from` like the leave plan (shift just before, else home); ' +
                '`from` and `previousShift` say which. Transit: up to 5 distinct routes arriving by the buffer time, ' +
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
