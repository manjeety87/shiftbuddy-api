// Same reason as domain.test.js: run in Toronto time so a hidden dependency on the server's zone shows up.
process.env.TZ = 'America/Toronto';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const { buildStatement } = require('../src/domain/statement');

const at = (iso) => DateTime.fromISO(iso, { zone: 'America/Toronto' }).toJSDate();
const boathouse = { id: 'b', title: 'Key Holder', companyName: 'Boathouse', hourlyRate: 19.3 };
const cafe = { id: 'c', title: 'Barista', companyName: '', hourlyRate: null };
const entry = (job, start, end, breakMinutes = 0) => ({ jobId: job.id, job, clockIn: at(start), clockOut: end && at(end), breakMinutes });

// The period: 7.5 h + 4 h at Boathouse, 3 h at the cafe, and one still on the clock
const period = [
    entry(boathouse, '2026-10-14T09:00', '2026-10-14T17:00', 30),
    entry(cafe, '2026-10-12T18:00', '2026-10-12T21:00'),
    entry(boathouse, '2026-10-13T12:00', '2026-10-13T16:00'),
    entry(boathouse, '2026-10-15T09:00', null),
];
// Earlier in the year: 10 more hours at Boathouse
const year = [...period, entry(boathouse, '2026-03-02T08:00', '2026-03-02T18:00')];

test('statement: hours and pay per job, the year so far, and the deduction estimate', () => {
    const statement = buildStatement({ entries: period, yearEntries: year, taxDeductionPercent: 15, showPay: true });
    const [first, second] = statement.jobs;

    assert.deepEqual(
        { name: first.name, role: first.role, rate: first.hourlyRate, minutes: first.paidMinutes, gross: first.grossPay, year: first.year },
        { name: 'Boathouse', role: 'Key Holder', rate: 19.3, minutes: 690, gross: 221.95, year: { paidMinutes: 1290, grossPay: 414.95 } },
    );
    // A job without a company is named by its title and has no separate role; no rate, no money
    assert.deepEqual({ name: second.name, role: second.role, gross: second.grossPay }, { name: 'Barista', role: null, gross: null });

    assert.equal(statement.totals.grossPay, 221.95);
    assert.equal(statement.totals.takeHome, 188.66);
    assert.equal(statement.totals.deductions, 33.29);
    assert.equal(statement.totals.missingRates, true);
    assert.equal(statement.totals.entryCount, 3); // the open entry isn't counted
});

test('statement: entries oldest first, the open one listed without hours', () => {
    const { entries } = buildStatement({ entries: period, yearEntries: year, taxDeductionPercent: 0, showPay: true });
    assert.deepEqual(entries.map((row) => [row.jobName, row.paidMinutes]), [['Barista', 180], ['Boathouse', 240], ['Boathouse', 450], ['Boathouse', null]]);
});

test('statement: with pay estimates off there is no money anywhere', () => {
    const statement = buildStatement({ entries: period, yearEntries: year, taxDeductionPercent: 15, showPay: false });
    const money = [statement.totals.grossPay, statement.totals.takeHome, statement.totals.deductions, statement.totals.year.grossPay, ...statement.jobs.flatMap((job) => [job.hourlyRate, job.grossPay, job.year.grossPay])];
    assert.ok(money.every((value) => value === null));
    assert.equal(statement.totals.missingRates, false);
    assert.equal(statement.totals.paidMinutes, 870);
});
