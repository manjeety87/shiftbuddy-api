// Options for the "schedule as a message" feature. Kept apart from the service
// so validation schemas (and, later, the web app) can use them without pulling
// in the database.
const SCHEDULE_RANGES = ['thisWeek', 'nextWeek', 'thisMonth'];
const NAME_STYLES = ['workplace', 'job'];

module.exports = { SCHEDULE_RANGES, NAME_STYLES };
