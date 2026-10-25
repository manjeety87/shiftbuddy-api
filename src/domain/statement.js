const { jobName } = require('./jobLabels');
const { estimatedPayOf, summarizeAcrossJobs } = require('./timesheet');

const round2 = (value) => Math.round(value * 100) / 100;

/**
 * A statement of hours for a stretch of days: what a pay stub shows, built only
 * from what the app knows. Per job: its hourly rate, the paid hours, gross pay
 * and the same for the year so far. In total: gross, the user's own deduction
 * percentage and what that leaves. Then every entry, oldest first, to check
 * against the employer's stub.
 *
 * No stat holiday pay, vacation pay, CPP, EI or tax lines — the app can't know
 * them, so it doesn't guess. Money only while pay estimates are on (`showPay`)
 * and only for jobs with a rate; `missingRates` says some hours aren't in it.
 * `entries` and `yearEntries` carry their `job`; an entry still on the clock is
 * listed but not counted.
 */
const buildStatement = ({ entries, yearEntries, taxDeductionPercent, showPay }) => {
    const period = summarizeAcrossJobs(entries);
    const year = summarizeAcrossJobs(yearEntries);
    const yearOf = new Map(year.byJob.map((line) => [line.job.id, line]));
    const money = (value) => (showPay ? value : null);

    const jobs = period.byJob.map((line) => ({
        name: jobName(line.job),
        role: line.job.companyName?.trim() ? line.job.title : null,
        hourlyRate: money(line.job.hourlyRate ?? null),
        entryCount: line.entryCount,
        paidMinutes: line.paidMinutes,
        grossPay: money(line.grossPay),
        year: { paidMinutes: yearOf.get(line.job.id)?.paidMinutes ?? 0, grossPay: money(yearOf.get(line.job.id)?.grossPay ?? null) },
    }));

    const gross = money(period.totals.grossPay);
    const takeHome = gross == null ? null : estimatedPayOf(gross, taxDeductionPercent);
    return {
        showPay,
        taxDeductionPercent,
        jobs,
        totals: {
            entryCount: period.totals.entryCount,
            paidMinutes: period.totals.paidMinutes,
            breakMinutes: period.totals.breakMinutes,
            grossPay: gross,
            deductions: takeHome == null ? null : round2(gross - takeHome),
            takeHome,
            missingRates: showPay && period.totals.missingRates,
            year: { paidMinutes: year.totals.paidMinutes, grossPay: money(year.totals.grossPay) },
        },
        entries: period.entries
            .map((entry) => ({ jobName: jobName(entry.job), clockIn: entry.clockIn, clockOut: entry.clockOut, breakMinutes: entry.breakMinutes, paidMinutes: entry.paidMinutes }))
            .sort((a, b) => a.clockIn - b.clockIn),
    };
};

module.exports = { buildStatement };
