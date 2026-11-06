// Limits and names for the assistant (POST /assistant/messages). Plain values,
// shared by the validation, the domain rules and the service.

/** One spoken or typed request; a long one is a pasted page, not a sentence. */
const MAX_ASSISTANT_MESSAGE = 500;
/** Earlier turns sent back with each request — enough for "yes", "make it 6", "and Friday too". */
const MAX_ASSISTANT_HISTORY = 12;
const MAX_HISTORY_TEXT = 1000;
/** Model calls in one turn: look something up, then act. A loop past this is a confused model. */
const MAX_ASSISTANT_STEPS = 4;
/**
 * The most one turn may spend waiting on Gemini, all steps and models together, and the
 * same for writing down a recording. The web app goes through a proxy that gives up
 * around 30 s; a turn that saved after that showed "Couldn't reach" (2026-11-05).
 */
const ASSISTANT_TURN_BUDGET_MS = 24000;
const TRANSCRIBE_BUDGET_MS = 20000;
/** The schedule the model sees without asking: the week before (hours to add) and two after. */
const CONTEXT_DAYS_BEFORE = 7;
const CONTEXT_DAYS_AFTER = 14;
const MAX_CONTEXT_SHIFTS = 40;
/** Shifts one card may add — two weeks of a regular pattern. */
const MAX_PROPOSED_SHIFTS = 14;
/** find_shifts: one lookup covers at most two months. */
const MAX_LOOKUP_DAYS = 62;
const MAX_LOOKUP_SHIFTS = 40;

/** Places in the app the assistant can open, by their web paths. */
const ASSISTANT_PAGES = ['home', 'shifts', 'calendar', 'jobs', 'timesheet', 'sharing', 'settings'];
/** Panels it can open without a shift: new shift/job/hours forms, pay, scan, statement, themes. */
const ASSISTANT_PANELS = ['newShift', 'newJob', 'addHours', 'paySummary', 'scan', 'statement', 'themes'];

// A job the assistant adds gets the first of these its owner isn't using yet (the app's job colours, web JobSheet)
const JOB_COLOURS = ['#6B8F71', '#B85C4E', '#C99A3A', '#5B8A9A', '#9B7EBD', '#C77B8E', '#7A9E7E'];

module.exports = {
    ASSISTANT_TURN_BUDGET_MS,
    TRANSCRIBE_BUDGET_MS,
    JOB_COLOURS,
    MAX_ASSISTANT_MESSAGE,
    MAX_ASSISTANT_HISTORY,
    MAX_HISTORY_TEXT,
    MAX_ASSISTANT_STEPS,
    CONTEXT_DAYS_BEFORE,
    CONTEXT_DAYS_AFTER,
    MAX_CONTEXT_SHIFTS,
    MAX_PROPOSED_SHIFTS,
    MAX_LOOKUP_DAYS,
    MAX_LOOKUP_SHIFTS,
    ASSISTANT_PAGES,
    ASSISTANT_PANELS,
};
