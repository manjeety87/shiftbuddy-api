const v = require('../../validation/timesheet.validation');
const { op, ok, ref, errors, error, pathParam } = require('../helpers');

const tag = 'Timesheet';
const entryId = pathParam('entryId', 'The time entry’s id');
const alreadyIn = error(409, '`details.code` ALREADY_CLOCKED_IN — `details.entry` is the open entry');

module.exports = {
    '/timesheet': {
        post: op({
            tag, body: v.createEntrySchema,
            summary: 'Add an entry by hand',
            description:
                'For hours the clock didn’t record. With `shiftId` they belong to that scheduled shift (one entry per shift — a second answers 409 ' +
                'ENTRY_EXISTS with `details.entry`); with `jobId` alone it’s work that wasn’t on the schedule. Same rules as fixing an entry ' +
                '(not in the future, at most 24 hours, break shorter than the entry). Without `breakMinutes` the usual break is assumed. ' +
                'A shift marked missed answers 409 SHIFT_MISSED.',
            responses: { ...ok('Entry added', ref('TimeEntry'), 201), ...errors.validation, ...errors.notFound },
        }),
        get: op({
            tag, query: v.timesheetQuerySchema,
            summary: 'One job’s timesheet for a pay period',
            description:
                'Hours actually worked (clock-ins), not the schedule. A pay period is the one or two full weeks (Sunday–Saturday, by the job’s ' +
                '`payFrequency`) before the week the job’s `payday` falls in; without a payday, periods follow calendar weeks. `offset` steps ' +
                'between periods. Each entry carries `paidMinutes` = time on the clock minus its unpaid break; an entry still on the clock is ' +
                'listed with `paidMinutes: null` and left out of the totals. `grossPay` is null when the job has no hourly rate.',
            responses: { ...ok('The timesheet', ref('Timesheet')), ...errors.validation, ...errors.notFound },
        }),
    },
    '/timesheet/week': {
        get: op({
            tag, query: v.weekQuerySchema,
            summary: 'All jobs together for one calendar week',
            description:
                '“How much did I work this week?” — every job’s entries for a Sunday–Saturday week (by week, not pay period, because each ' +
                'job has its own). `byJob` has a line per job, most hours first. `totals.grossPay` only adds jobs that have an hourly rate; ' +
                '`totals.missingRates` is true when some hours aren’t in that figure.',
            responses: { ...ok('The week', ref('WeekTimesheet')), ...errors.validation },
        }),
    },
    '/timesheet/summary': {
        get: op({
            tag, query: v.summaryQuerySchema,
            summary: 'Hours and pay per job for a week, two weeks, a month or all time',
            description:
                'Every job together: `byJob` (most hours first) and `totals` with paid minutes, entry count, `grossPay` (jobs with an hourly ' +
                'rate only — `missingRates` says when some hours aren’t in it) and `estimatedPay` (gross less the user’s `taxDeductionPercent`). ' +
                'Weeks run Sunday–Saturday; `twoWeeks` is this week and last; `month` is the calendar month. `range=all` covers everything ' +
                'and sends no `entries` (its `period.start` is the first day with hours).',
            responses: { ...ok('The summary', { type: 'object' }), ...errors.validation },
        }),
    },
    '/timesheet/statement': {
        get: op({
            tag, query: v.statementQuerySchema,
            summary: 'The hours for a stretch as a PDF statement',
            description:
                'A file to keep or send, built only from what the app knows: per job the hourly rate, paid hours (decimal, like a pay stub), ' +
                'gross pay and the same since January 1; gross less the user’s `taxDeductionPercent`; then every entry, oldest first. With ' +
                '`jobId` it covers that job’s pay period (`offset` steps between periods) — the one to compare with its pay stub; without, ' +
                'every job for `range`. No money at all while `features.pay` is off; no stat holiday, vacation pay, CPP, EI or tax lines. ' +
                'Answers `application/pdf` as an attachment; errors are JSON as usual.',
            responses: {
                200: { description: 'The statement', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } },
                ...errors.validation, ...errors.notFound, ...errors.rateLimited,
            },
        }),
    },
    '/timesheet/current': {
        get: op({
            tag,
            summary: 'The entry the user is clocked in on',
            description: 'What Home shows while working. `data` is null when not clocked in.',
            responses: { ...ok('Open entry (or null)', { ...ref('TimeEntry'), nullable: true }) },
        }),
    },
    '/timesheet/unlogged': {
        get: op({
            tag,
            summary: 'Finished shifts waiting for hours',
            description:
                'What Home asks about (“Add your hours?”): shifts that ended in the last 7 days with no entry and not marked missed, oldest ' +
                'first, each with `suggested` — its scheduled start and end and the usual break. Saving one is POST /timesheet with the ' +
                '`shiftId`. Empty while `features.timesheet` is off, and while `features.autoHours` is on (an hourly run adds them by itself).',
            responses: {
                ...ok('Shifts and suggested entries', {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            shift: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, startTime: { type: 'string', format: 'date-time' }, endTime: { type: 'string', format: 'date-time' }, job: { type: 'object' } } },
                            suggested: { type: 'object', properties: { clockIn: { type: 'string', format: 'date-time' }, clockOut: { type: 'string', format: 'date-time' }, breakMinutes: { type: 'integer' }, paidMinutes: { type: 'integer' } } },
                        },
                    },
                }),
            },
        }),
    },
    '/timesheet/clock-in': {
        post: op({
            tag, body: v.clockInSchema,
            summary: 'Start the clock',
            description:
                'For a scheduled shift, and only from 10 minutes before it starts until it ends: earlier answers 400 with `details.code` ' +
                'TOO_EARLY and `details.opensAt`; after the end, SHIFT_OVER. The time is the server’s “now”. Only one clock runs at a time. ' +
                'Hours outside a shift are added with POST /timesheet. A shift marked missed answers 409 SHIFT_MISSED.',
            responses: { ...ok('Clocked in', ref('TimeEntry'), 201), ...errors.validation, ...errors.notFound, ...alreadyIn },
        }),
    },
    '/timesheet/clock-out': {
        post: op({
            tag,
            summary: 'Stop the clock',
            description:
                'Ends the open entry at the server’s “now” and fills in the usual unpaid break: 30 minutes once the entry is longer than 5 hours ' +
                '(Ontario’s eating-period rule). The user can change the break afterwards.',
            responses: { ...ok('Clocked out', ref('TimeEntry')), ...error(409, '`details.code` NOT_CLOCKED_IN') },
        }),
    },
    '/timesheet/{entryId}': {
        get: op({
            tag, params: [entryId],
            summary: 'One time entry',
            description: 'For the edit screen.',
            responses: { ...ok('The entry', ref('TimeEntry')), ...errors.notFound },
        }),
        patch: op({
            tag, params: [entryId], body: v.updateEntrySchema,
            summary: 'Fix a time entry',
            description:
                'Change the clock-in, clock-out or break — for a forgotten clock-out or a longer break. Clock-out must be after clock-in, not in ' +
                'the future, at most 24 hours later, and the break shorter than the entry. `clockOut: null` puts the entry back on the clock.',
            responses: { ...ok('Updated entry', ref('TimeEntry')), ...errors.validation, ...errors.notFound, ...alreadyIn },
        }),
        delete: op({
            tag, params: [entryId],
            summary: 'Delete a time entry',
            description: 'Removes it from the timesheet. The scheduled shift, if any, is untouched.',
            responses: { ...ok('Deleted'), ...errors.notFound },
        }),
    },
};
