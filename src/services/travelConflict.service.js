const prisma = require('../config/prisma');
const { NOT_MISSED } = require('../constants/shifts');
const { getDrivingMinutes } = require('./driving.service');
const transitService = require('./transit.service');
const { coordsOf, findTravelPairs } = require('../domain/travel');
const { mapWithLimit } = require('../utils/mapWithLimit');

// "Can I actually get from one job to the next in time?"
// Looks at each pair of back-to-back shifts at different places and compares
// the gap between them with the real travel time for the user's commute mode.

const DEFAULT_WINDOW_DAYS = 14;
const MAX_WINDOW_DAYS = 31;
const TIGHT_SLACK_MINUTES = 5; // arriving with less than this to spare is worth a heads-up
// A busy fortnight can have a dozen pairs; the routing servers are volunteer-run,
// so they're asked a few at a time (answers are cached, so repeats cost nothing)
const MAX_PAIRS_CHECKED_AT_ONCE = 3;

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** When you'd arrive at the next job, leaving the moment the first shift ends. null = couldn't work it out. */
const estimateArrival = async (mode, from, to, leaveAt) => {
    if (mode === 'DRIVING') {
        const minutes = await getDrivingMinutes(from, to);
        return minutes == null ? null : { arrival: new Date(leaveAt.getTime() + minutes * MINUTE_MS), travelMinutes: minutes };
    }

    const { itineraries } = await transitService.planTrip({ from, to, time: leaveAt, timeType: 'depart' });
    const first = itineraries[0]; // sorted by arrival — the soonest you can get there
    if (!first) return null;
    const arrival = new Date(first.arrival);
    return { arrival, travelMinutes: Math.round((arrival.getTime() - leaveAt.getTime()) / MINUTE_MS) };
};

/**
 * The latest you can leave `from` and still reach `to` by `arriveBy` — the
 * "leave early" fix. Transit uses a real arrive-by search (timetables don't
 * run backwards from arrival evenly); driving just subtracts the drive time.
 */
const latestDeparture = async (mode, from, to, arriveBy) => {
    if (mode === 'DRIVING') {
        const minutes = await getDrivingMinutes(from, to);
        return minutes == null ? null : new Date(arriveBy.getTime() - minutes * MINUTE_MS);
    }
    const { itineraries } = await transitService.planTrip({ from, to, time: arriveBy, timeType: 'arrive' });
    const latest = itineraries[0]; // sorted by departure, latest first
    return latest ? new Date(latest.departure) : null;
};

/** One pair of back-to-back shifts → the conflict to report, or null when the trip fits (or can't be worked out). */
const checkPair = async (mode, { first, next, gapMinutes }) => {
    try {
        const from = coordsOf(first.job);
        const to = coordsOf(next.job);

        const estimate = await estimateArrival(mode, from, to, first.endTime);
        if (!estimate) return null;

        const slackMinutes = Math.round((next.startTime.getTime() - estimate.arrival.getTime()) / MINUTE_MS);
        if (slackMinutes >= TIGHT_SLACK_MINUTES) return null;

        // Two ways out, so the app can say exactly what would fix it
        const leaveBy = await latestDeparture(mode, from, to, next.startTime);

        return {
            severity: slackMinutes < 0 ? 'late' : 'tight',
            mode,
            fromShift: first,
            toShift: next,
            gapMinutes,
            travelMinutes: estimate.travelMinutes,
            estimatedArrival: estimate.arrival,
            lateByMinutes: Math.max(0, -slackMinutes),
            slackMinutes: Math.max(0, slackMinutes),
            // Fix 1: leave the first job this early. null when no trip gets there in
            // time, or when "in time" would mean leaving before that shift even starts
            leaveBy: leaveBy && leaveBy > first.startTime && leaveBy < first.endTime ? leaveBy : null,
            // Fix 2: start the next shift once you can actually be there
            earliestStart: estimate.arrival,
        };
    } catch (err) {
        // One unreachable routing call shouldn't hide the other warnings
        console.error('Travel check failed for shift pair:', err.message);
        return null;
    }
};

const findTravelConflicts = async (userId, { from, to } = {}) => {
    const windowStart = from ?? new Date();
    const requestedEnd = to ?? new Date(windowStart.getTime() + DEFAULT_WINDOW_DAYS * DAY_MS);
    const windowEnd = new Date(Math.min(requestedEnd.getTime(), windowStart.getTime() + MAX_WINDOW_DAYS * DAY_MS));

    const [user, shifts] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId }, select: { commuteMode: true } }),
        prisma.shift.findMany({
            // Includes a shift still running when the window opens: "I'm at work now
            // and the next job starts soon" is the most urgent pair there is
            where: { userId, ...NOT_MISSED, endTime: { gt: windowStart }, startTime: { lte: windowEnd } },
            include: { job: true },
            orderBy: { startTime: 'asc' },
        }),
    ]);
    const mode = user?.commuteMode ?? 'TRANSIT';

    const checks = await mapWithLimit(findTravelPairs(shifts), MAX_PAIRS_CHECKED_AT_ONCE, (pair) => checkPair(mode, pair));
    return { mode, conflicts: checks.filter(Boolean) };
};

module.exports = { findTravelConflicts };
