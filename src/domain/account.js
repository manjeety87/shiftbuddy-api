// Account rules with no database in them: how long a deleted account can still be
// brought back, and how a signed-in device is named in "Where you’re signed in".

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days between asking to delete an account and it being erased. Signing in before then can restore it. */
const DELETION_GRACE_DAYS = 30;

/** Typed by someone whose account has no password (Google/Apple) to confirm a deletion. */
const DELETE_CONFIRMATION = 'DELETE';

/** When an account asked to be deleted at `requestedAt` is erased for good. */
const purgeDateFor = (requestedAt) => new Date(new Date(requestedAt).getTime() + DELETION_GRACE_DAYS * DAY_MS);

/** Accounts asked to be deleted before this moment are past their grace period. */
const purgeCutoff = (now = new Date()) => new Date(now.getTime() - DELETION_GRACE_DAYS * DAY_MS);

// Order matters: Edge and Opera say "Chrome" too, Chrome says "Safari", every iPhone browser says "Safari"
const BROWSERS = [
    [/Edg(e|A|iOS)?\//, 'Edge'],
    [/OPR\/|Opera/, 'Opera'],
    [/SamsungBrowser\//, 'Samsung Internet'],
    [/Firefox\/|FxiOS\//, 'Firefox'],
    [/Chrome\/|CriOS\//, 'Chrome'],
    [/Safari\//, 'Safari'],
];

const SYSTEMS = [
    [/iPhone/, 'iPhone'],
    [/iPad/, 'iPad'],
    [/Android/, 'Android'],
    [/Windows/, 'Windows'],
    [/CrOS/, 'ChromeOS'],
    [/Mac OS X|Macintosh/, 'Mac'],
    [/Linux/, 'Linux'],
];

const firstMatch = (list, text) => list.find(([pattern]) => pattern.test(text))?.[1] ?? null;

/**
 * A device's user agent → `{ kind, name }` for people to read: "Chrome on Windows",
 * "ShiftBuddy app on iPhone". The phone app's requests don't come from a browser:
 * Android sends okhttp's agent, iOS sends CFNetwork/Darwin.
 */
const describeDevice = (userAgent) => {
    const agent = userAgent ?? '';
    if (/okhttp/i.test(agent)) return { kind: 'app', name: 'ShiftBuddy app on Android' };
    if (/CFNetwork|Darwin/.test(agent) && !/Mozilla/.test(agent)) return { kind: 'app', name: 'ShiftBuddy app on iPhone' };

    const browser = firstMatch(BROWSERS, agent);
    const system = firstMatch(SYSTEMS, agent);
    if (browser && system) return { kind: 'browser', name: `${browser} on ${system}` };
    if (browser || system) return { kind: 'browser', name: browser ?? `A browser on ${system}` };
    return { kind: 'unknown', name: 'Unknown device' };
};

module.exports = { DELETION_GRACE_DAYS, DELETE_CONFIRMATION, purgeDateFor, purgeCutoff, describeDevice };
