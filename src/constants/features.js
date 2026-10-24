// Parts of the app a user can switch on or off (Settings › Features in both apps).
// Saved on the account, so the phone and the web show the same app. A key the
// account hasn't stored uses its default here, so a new part reaches everyone
// without a migration. Shifts, jobs, the calendar, clashes and Home's next-shift
// card are the app itself and always on.

const FEATURE_DEFAULTS = {
    /** When to leave for a shift, routes, and how early to arrive */
    leaveBy: true,
    /** The temperature on the next shift and what to wear */
    weather: true,
    /** Clock in and out, hours worked, pay periods, and the "add your hours?" prompt */
    timesheet: false,
    /** Estimated pay and deductions */
    pay: false,
    /** Schedules people share with you, beside your own on Home's calendar */
    sharedOnHome: true,
    /** The hours-and-pay card above the calendar */
    calendarSummary: true,
    /** With the timesheet on: a finished shift's scheduled hours are added by themselves */
    autoHours: false,
};

const FEATURE_KEYS = Object.keys(FEATURE_DEFAULTS);

module.exports = { FEATURE_DEFAULTS, FEATURE_KEYS };
