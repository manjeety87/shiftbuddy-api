// Same reason as domain.test.js: run in Toronto time so a hidden dependency on the server's zone shows up.
process.env.TZ = 'America/Toronto';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const { clockInWindow, weekOn, summarizeAcrossJobs, scheduledEntryFor } = require('../src/domain/timesheet');
const { resolveFeatures, mergeFeatures, addsHoursByItself } = require('../src/domain/features');
const { updateProfileSchema } = require('../src/validation/user.validation');

const TORONTO = 'America/Toronto';
const at = (iso) => DateTime.fromISO(iso, { zone: TORONTO }).toJSDate();
const localTime = (date) => DateTime.fromJSDate(date, { zone: TORONTO }).toFormat("yyyy-MM-dd'T'HH:mm");

const boathouse = { title: 'Sales Associate', companyName: 'Boathouse', hourlyRate: 18 };
const cafe = { title: 'Barista', companyName: 'Cafe', hourlyRate: null };

test('clock-in window opens 10 minutes before a shift and closes when it ends', () => {
    const { opensAt, closesAt } = clockInWindow({ startTime: at('2026-10-05T14:00'), endTime: at('2026-10-05T21:00') });
    assert.deepEqual([localTime(opensAt), localTime(closesAt)], ['2026-10-05T13:50', '2026-10-05T21:00']);
});

test('all-jobs week runs Sunday to Saturday in the user’s zone', () => {
    const week = weekOn(at('2026-10-07T23:30'), TORONTO);
    assert.deepEqual([week.start.toISODate(), week.end.minus({ days: 1 }).toISODate()], ['2026-10-04', '2026-10-10']);
    assert.equal(weekOn(at('2026-10-07T23:30'), TORONTO, -1).start.toISODate(), '2026-09-27');
    // Saturday 11:30 PM in Toronto is already Sunday in UTC — still this week here
    assert.equal(weekOn(new Date('2026-10-11T03:30:00Z'), TORONTO).start.toISODate(), '2026-10-04');
});

test('all-jobs summary: a line per job, most hours first; pay only where there is a rate', () => {
    const entry = (jobId, job, start, end, breakMinutes) => ({ jobId, job, clockIn: at(start), clockOut: end ? at(end) : null, breakMinutes });
    const { byJob, totals, entries } = summarizeAcrossJobs([
        entry('job-2', cafe, '2026-10-06T10:00', '2026-10-06T12:00', 0), // 2 h, no rate
        entry('job-1', boathouse, '2026-10-05T09:00', '2026-10-05T17:00', 30), // 7.5 h at $18
        entry('job-1', boathouse, '2026-10-07T09:00', '2026-10-07T11:00', 0), // 2 h at $18
        entry('job-2', cafe, '2026-10-08T09:00', null, 0), // on the clock: listed, not counted
    ]);

    assert.deepEqual(byJob.map((line) => [line.job.companyName, line.entryCount, line.paidMinutes, line.grossPay]), [['Boathouse', 2, 570, 171], ['Cafe', 1, 120, null]]);
    assert.deepEqual(totals, { entryCount: 3, paidMinutes: 690, breakMinutes: 30, grossPay: 171, missingRates: true });
    assert.equal(entries.length, 4);
    assert.deepEqual(summarizeAcrossJobs([]).totals, { entryCount: 0, paidMinutes: 0, breakMinutes: 0, grossPay: null, missingRates: false });
});

test('summary ranges: Sun–Sat week, this week and last, calendar month, all', () => {
    const { summaryRangeOn, SUMMARY_RANGES } = require('../src/domain/timesheet');
    const { summaryQuerySchema } = require('../src/validation/timesheet.validation');
    const zone = 'America/Toronto';
    const tuesday = DateTime.fromISO('2026-10-20T12:00', { zone }).toJSDate();
    const days = (span) => `${span.start.toISODate()}..${span.end.minus({ days: 1 }).toISODate()}`;

    assert.equal(days(summaryRangeOn('week', tuesday, zone)), '2026-10-18..2026-10-24');
    assert.equal(days(summaryRangeOn('week', tuesday, zone, -1)), '2026-10-11..2026-10-17');
    assert.equal(days(summaryRangeOn('twoWeeks', tuesday, zone)), '2026-10-11..2026-10-24');
    assert.equal(days(summaryRangeOn('twoWeeks', tuesday, zone, -1)), '2026-09-27..2026-10-10');
    assert.equal(days(summaryRangeOn('month', tuesday, zone)), '2026-10-01..2026-10-31');
    assert.equal(days(summaryRangeOn('month', tuesday, zone, -1)), '2026-09-01..2026-09-30');
    assert.equal(summaryRangeOn('all', tuesday, zone), null);
    // The validation list (zod-only file) must match the domain's
    for (const range of SUMMARY_RANGES) assert.ok(summaryQuerySchema.safeParse({ range, timeZone: zone }).success, range);
    assert.ok(!summaryQuerySchema.safeParse({ range: 'year', timeZone: zone }).success);
});

test('estimated pay takes the user’s deduction off gross, and needs a gross figure', () => {
    const { estimatedPayOf } = require('../src/domain/timesheet');
    assert.equal(estimatedPayOf(100, 13), 87);
    assert.equal(estimatedPayOf(123.45, 13), 107.4);
    assert.equal(estimatedPayOf(null, 13), null);
    assert.equal(estimatedPayOf(50, 0), 50);
});

test('scheduled entry: the shift’s own times, with the usual break once it passes 5 hours', () => {
    const long = scheduledEntryFor({ startTime: at('2026-10-05T09:00'), endTime: at('2026-10-05T17:00') });
    assert.deepEqual([localTime(long.clockIn), localTime(long.clockOut), long.breakMinutes, long.paidMinutes], ['2026-10-05T09:00', '2026-10-05T17:00', 30, 450]);
    const short = scheduledEntryFor({ startTime: at('2026-10-05T09:00'), endTime: at('2026-10-05T13:00') });
    assert.deepEqual([short.breakMinutes, short.paidMinutes], [0, 240]);
});

test('features: unchosen ones are their defaults, unknown keys are dropped', () => {
    assert.deepEqual(resolveFeatures({}), { leaveBy: true, weather: true, timesheet: false, pay: false, sharedOnHome: true, calendarSummary: true, autoHours: false });
    assert.equal(resolveFeatures(null).weather, true);
    const resolved = resolveFeatures({ timesheet: true, weather: false, junk: true, pay: 'yes' });
    assert.deepEqual([resolved.timesheet, resolved.weather, resolved.pay, 'junk' in resolved], [true, false, false, false]);
});

test('features: a change keeps the other choices; hours add themselves only with the timesheet on', () => {
    assert.deepEqual(mergeFeatures({ timesheet: true, junk: 1 }, { weather: false }), { timesheet: true, weather: false });
    assert.equal(addsHoursByItself(resolveFeatures({ autoHours: true })), false);
    assert.equal(addsHoursByItself(resolveFeatures({ autoHours: true, timesheet: true })), true);
});

test('features: the profile takes known switches as booleans only', () => {
    assert.deepEqual(updateProfileSchema.parse({ features: { pay: true } }), { features: { pay: true } });
    assert.equal(updateProfileSchema.safeParse({ features: { pay: 'on' } }).success, false);
    assert.equal(updateProfileSchema.safeParse({ features: { dragons: true } }).success, false);
});
