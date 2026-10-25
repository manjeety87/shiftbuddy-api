// Same reason as domain.test.js: run in Toronto time so a hidden dependency on the server's zone shows up.
process.env.TZ = 'America/Toronto';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const { buildStatement, statementSpan } = require('../src/domain/statement');
const { statementQuerySchema } = require('../src/validation/shift.validation');

const ZONE = 'America/Toronto';
const at = (iso) => DateTime.fromISO(iso, { zone: ZONE }).toJSDate();
const boathouse = { id: 'b', title: 'Key Holder', companyName: 'Boathouse', hourlyRate: 19.3 };
const cafe = { id: 'c', title: 'Barista', companyName: '', hourlyRate: null };
const shift = (job, start, end, entry) => ({ job, startTime: at(start), endTime: at(end), timeEntries: entry ? [{ clockIn: at(entry[0]), clockOut: at(entry[1]), breakMinutes: entry[2] }] : [] });

// Boathouse: one clocked 7.5 h (8 h less a 30 min break), one 4 h from the schedule; the cafe: 3 h typed in without a shift
const shifts = [
    shift(boathouse, '2026-10-14T09:00', '2026-10-14T17:00', ['2026-10-14T09:00', '2026-10-14T17:00', 30]),
    shift(boathouse, '2026-10-13T12:00', '2026-10-13T16:00'),
];
const looseEntries = [{ job: cafe, clockIn: at('2026-10-12T18:00'), clockOut: at('2026-10-12T21:00'), breakMinutes: 0 }];

test('statement: every shift oldest first, clocked hours over the schedule, totals per job', () => {
    const statement = buildStatement({ shifts, looseEntries, taxDeductionPercent: 15, showPay: true });

    assert.deepEqual(
        statement.rows.map((row) => [row.jobName, row.role, row.paidMinutes, row.source]),
        [['Barista', null, 180, 'clocked'], ['Boathouse', 'Key Holder', 240, 'scheduled'], ['Boathouse', 'Key Holder', 450, 'clocked']],
    );
    assert.deepEqual(statement.jobs[0], { name: 'Boathouse', role: 'Key Holder', shiftCount: 2, paidMinutes: 690, hourlyRate: 19.3, grossPay: 221.95 });
    // A job without a rate has no money, and says so in the totals
    assert.equal(statement.jobs[1].grossPay, null);
    assert.deepEqual(statement.totals, { shiftCount: 3, scheduledCount: 1, paidMinutes: 870, grossPay: 221.95, deductions: 33.29, takeHome: 188.66, missingRates: true });
});

test('statement: with pay estimates off there is no money anywhere', () => {
    const { jobs, totals } = buildStatement({ shifts, looseEntries, taxDeductionPercent: 15, showPay: false });
    const money = [totals.grossPay, totals.takeHome, totals.deductions, ...jobs.flatMap((job) => [job.hourlyRate, job.grossPay])];
    assert.ok(money.every((value) => value === null));
    assert.equal(totals.missingRates, false);
});

test('statement span: presets in the user’s zone, three months, and a custom range with both days included', () => {
    const now = at('2026-10-25T10:00'); // a Sunday
    const days = ({ start, end }) => [start.toISODate(), end.toISODate()];
    assert.deepEqual(days(statementSpan({ range: 'week' }, now, ZONE)), ['2026-10-25', '2026-11-01']);
    assert.deepEqual(days(statementSpan({ range: 'month', offset: -1 }, now, ZONE)), ['2026-09-01', '2026-10-01']);
    assert.deepEqual(days(statementSpan({ range: 'threeMonths' }, now, ZONE)), ['2026-08-01', '2026-11-01']);
    assert.deepEqual(days(statementSpan({ range: 'threeMonths', offset: -1 }, now, ZONE)), ['2026-05-01', '2026-08-01']);
    assert.deepEqual(days(statementSpan({ range: 'custom', from: '2026-10-01', to: '2026-10-15' }, now, ZONE)), ['2026-10-01', '2026-10-16']);
});

test('statement query: custom needs both days, in order, at most a year apart', () => {
    const parse = (query) => statementQuerySchema.safeParse({ timeZone: ZONE, ...query }).success;
    assert.equal(parse({ range: 'custom', from: '2026-10-01', to: '2026-10-15' }), true);
    assert.equal(parse({ range: 'custom', from: '2026-10-01' }), false);
    assert.equal(parse({ range: 'custom', from: '2026-10-15', to: '2026-10-01' }), false);
    assert.equal(parse({ range: 'custom', from: '2025-01-01', to: '2026-10-01' }), false);
    assert.equal(parse({ range: 'all' }), false);
});
