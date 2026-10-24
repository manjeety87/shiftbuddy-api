const { FEATURE_DEFAULTS, FEATURE_KEYS } = require('../constants/features');

// Which parts of the app a user has on. The account stores only what was chosen
// (a JSON object); everything else is its default.

/** Every feature, true or false: what was stored, else the default. Unknown keys are dropped. */
const resolveFeatures = (stored) => {
    const saved = stored && typeof stored === 'object' ? stored : {};
    return Object.fromEntries(FEATURE_KEYS.map((key) => [key, typeof saved[key] === 'boolean' ? saved[key] : FEATURE_DEFAULTS[key]]));
};

/** What to store after `changes`: the old choices with the new ones on top (only known keys). */
const mergeFeatures = (stored, changes) => {
    const saved = stored && typeof stored === 'object' ? stored : {};
    const kept = Object.fromEntries(FEATURE_KEYS.filter((key) => typeof saved[key] === 'boolean').map((key) => [key, saved[key]]));
    return { ...kept, ...changes };
};

/** Scheduled hours are added by themselves only while the timesheet itself is on. */
const addsHoursByItself = (features) => features.timesheet && features.autoHours;

module.exports = { resolveFeatures, mergeFeatures, addsHoursByItself };
