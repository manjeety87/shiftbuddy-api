// Limits on a single shift and on shift requests. Plain values, shared by the
// validation schemas and the services (and, later, the web app).

/** Nobody works a single shift longer than this; a longer one is a date typed wrong. */
const MAX_SHIFT_HOURS = 24;
const MAX_NOTES_LENGTH = 500;
/** Most shifts one bulk request may create (scan import, copy). */
const MAX_BULK_SHIFTS = 100;
/** Most shifts one list request returns — years of schedule; soonest first. */
const MAX_SHIFTS_PER_LIST = 1000;

module.exports = { MAX_SHIFT_HOURS, MAX_NOTES_LENGTH, MAX_BULK_SHIFTS, MAX_SHIFTS_PER_LIST };
