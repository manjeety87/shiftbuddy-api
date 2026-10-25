const { DateTime } = require('luxon');
const { jobName } = require('./jobLabels');
const { estimatedPayOf, paidMinutes, scheduledEntryFor, summaryRangeOn } = require('./timesheet');

const round2 = (value) => Math.round(value * 100) / 100;

/**
 * The days a statement covers, in `timeZone`: { start, end } with `end` exclusive.
 * The presets are the summary's stretches plus `threeMonths` (this calendar month
 * and the two before); `offset` steps back by whole stretches. `custom` runs from
 * the start of `from` to the end of `to`.
 */
const statementSpan = ({ range, offset = 0, from, to }, now, timeZone) => {
    if (range === 'custom') {
        return { start: DateTime.fromISO(from, { zone: timeZone }).startOf('day'), end: DateTime.fromISO(to, { zone: timeZone }).startOf('day').plus({ days: 1 }) };
    }
    if (range === 'threeMonths') {
        const start = DateTime.fromJSDate(now, { zone: timeZone }).startOf('month').minus({ months: 2 }).plus({ months: 3 * offset });
        return { start, end: start.plus({ months: 3 }) };
    }
    return summaryRangeOn(range, now, timeZone, offset);
};

/**
 * A statement of the shifts worked, like a bank's e-statement: every finished
 * shift (oldest first) with its job, role, times and hours, then the totals per
 * job and overall. A shift's hours are the clocked ones when it has them, else
 * its scheduled times with the usual break (`source` says which). Hours typed in
 * without a shift (`looseEntries`) are listed too.
 *
 * Money only while pay estimates are on (`showPay`) and only for jobs with a
 * rate; `missingRates` says some hours aren't in it. No stat holiday, vacation,
 * CPP, EI or tax lines — the app can't know them, so it doesn't guess.
 * `shifts` carry `job` and their closed `timeEntries`; `looseEntries` carry `job`.
 */
const buildStatement = ({ shifts, looseEntries, taxDeductionPercent, showPay }) => {
    const rowOf = (job, worked, source) => ({
        jobId: job.id,
        jobName: jobName(job),
        role: job.companyName?.trim() ? job.title : null,
        start: worked.clockIn,
        end: worked.clockOut,
        breakMinutes: worked.breakMinutes,
        paidMinutes: paidMinutes(worked),
        source,
    });
    const rows = [
        ...shifts.map((shift) => {
            const clocked = shift.timeEntries.find((entry) => entry.clockOut);
            return clocked ? rowOf(shift.job, clocked, 'clocked') : rowOf(shift.job, scheduledEntryFor(shift), 'scheduled');
        }),
        ...looseEntries.map((entry) => rowOf(entry.job, entry, 'clocked')),
    ].sort((a, b) => a.start - b.start);

    const jobOf = new Map([...shifts, ...looseEntries].map(({ job }) => [job.id, job]));
    const groups = new Map();
    for (const row of rows) groups.set(row.jobId, [...(groups.get(row.jobId) ?? []), row]);
    const jobs = [...groups.entries()]
        .map(([jobId, jobRows]) => {
            const job = jobOf.get(jobId);
            const minutes = jobRows.reduce((sum, row) => sum + row.paidMinutes, 0);
            const rate = showPay ? (job.hourlyRate ?? null) : null;
            return { name: jobName(job), role: job.companyName?.trim() ? job.title : null, shiftCount: jobRows.length, paidMinutes: minutes, hourlyRate: rate, grossPay: rate == null ? null : round2((minutes / 60) * rate) };
        })
        .sort((a, b) => b.paidMinutes - a.paidMinutes);

    const paid = jobs.filter((job) => job.grossPay != null);
    const gross = showPay && paid.length > 0 ? round2(paid.reduce((sum, job) => sum + job.grossPay, 0)) : null;
    const takeHome = estimatedPayOf(gross, taxDeductionPercent);
    return {
        showPay,
        taxDeductionPercent,
        rows,
        jobs,
        totals: {
            shiftCount: rows.length,
            scheduledCount: rows.filter((row) => row.source === 'scheduled').length,
            paidMinutes: rows.reduce((sum, row) => sum + row.paidMinutes, 0),
            grossPay: gross,
            deductions: takeHome == null ? null : round2(gross - takeHome),
            takeHome,
            missingRates: showPay && paid.length < jobs.length,
        },
    };
};

module.exports = { statementSpan, buildStatement };
