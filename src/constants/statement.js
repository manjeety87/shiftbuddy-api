// The stretches a shift statement can cover. Plain values, shared by the
// validation schema and the domain rules (and, later, the apps).

/** week (Sun–Sat), twoWeeks (this week and last), month, threeMonths (this month and the two before), custom (from–to) */
const STATEMENT_RANGES = ['week', 'twoWeeks', 'month', 'threeMonths', 'custom'];
/** A custom statement covers at most a year — longer is a date typed wrong, and a PDF nobody reads. */
const MAX_STATEMENT_DAYS = 366;

module.exports = { STATEMENT_RANGES, MAX_STATEMENT_DAYS };
