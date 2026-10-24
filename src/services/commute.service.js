const prisma = require('../config/prisma');
const { NOT_MISSED } = require('../constants/shifts');
const ApiError = require('../utils/ApiError');
const transitService = require('./transit.service');
const { getDrivingRoute } = require('./driving.service');
const { jobName } = require('../domain/jobLabels');
const { hasLocation, coordsOf, isSamePlace, previousShiftFor, walkingMinutes, MAX_GAP_MINUTES } = require('../domain/travel');

// Getting to a shift: when to leave and how. Everything is worked out here so the
// phone app and the web app get the same answers from one place.

const MINUTE_MS = 60 * 1000;

/**
 * The shift (with its job), the user's commute preferences, and the shift they
 * come straight from, if any — 404 if the shift isn't theirs.
 */
const loadContext = async (userId, shiftId) => {
    const [shift, user] = await Promise.all([
        prisma.shift.findFirst({ where: { id: shiftId, userId }, include: { job: true } }),
        prisma.user.findUnique({
            where: { id: userId },
            select: { homeLatitude: true, homeLongitude: true, commuteMode: true, arrivalBufferMinutes: true },
        }),
    ]);
    if (!shift || !user) throw new ApiError(404, 'Shift not found');

    // Only shifts ending in the few hours before this one can be where the trip starts
    const before = await prisma.shift.findMany({
        where: { userId, ...NOT_MISSED, id: { not: shift.id }, endTime: { lte: shift.startTime, gte: new Date(shift.startTime.getTime() - MAX_GAP_MINUTES * MINUTE_MS) } },
        include: { job: true },
    });
    return { shift, user, previous: previousShiftFor(shift, before) };
};

const homeOf = (user) => {
    const home = { latitude: user.homeLatitude, longitude: user.homeLongitude };
    return hasLocation(home) ? coordsOf(home) : null;
};

/**
 * Where the trip starts. `auto` (the default): the job of the shift just before,
 * if there is one with a pin — they're already out — otherwise home. `home` and
 * `previousShift` ask for one of them by name ("what if I came from home?").
 * null when the one asked for doesn't exist.
 */
const startingPoint = ({ user, previous }, choice = 'auto') => {
    const home = homeOf(user);
    const fromPrevious = previous && {
        kind: 'previousShift',
        name: jobName(previous.job),
        shiftId: previous.id,
        endsAt: previous.endTime,
        place: coordsOf(previous.job),
    };
    const fromHome = home && { kind: 'home', name: 'Home', place: home };

    if (choice === 'home') return fromHome;
    if (choice === 'previousShift') return fromPrevious;
    return fromPrevious ?? fromHome;
};

/** What the client is told about the starting point (coordinates stay out). */
const describe = (start) => start && { kind: start.kind, name: start.name, ...(start.endsAt && { endsAt: start.endsAt, shiftId: start.shiftId }) };

/** The moment to be at work: the shift start minus the user's chosen buffer. */
const arriveByFor = (shift, user) => new Date(shift.startTime.getTime() - user.arrivalBufferMinutes * MINUTE_MS);

const linesOf = (itinerary) => itinerary.legs.filter((leg) => leg.mode !== 'WALK').map((leg) => leg.line).filter(Boolean);

/**
 * When to leave for a shift, and from where, by the user's usual way of getting
 * around. Coming from the shift before: in the same building there's nothing to
 * plan; when the gap is shorter than the trip, they leave the moment it ends and
 * `lateMinutes` says by how much they'll miss the start. null once the shift has
 * started or is marked missed, or when it can't be worked out (no starting point, no job pin, no route).
 * Within walking distance `mode` is WALK, whatever the usual commute.
 */
const getLeavePlan = async (userId, shiftId, { from = 'auto' } = {}) => {
    const context = await loadContext(userId, shiftId);
    const { shift, user, previous } = context;
    if (shift.missedReason || Date.now() >= shift.startTime.getTime()) return null;

    const start = startingPoint(context, from);
    if (!start || !hasLocation(shift.job)) return null;

    const arriveBy = arriveByFor(shift, user);
    const base = {
        mode: user.commuteMode,
        arriveBy,
        arrivalBufferMinutes: user.arrivalBufferMinutes,
        from: describe(start),
        // What the other choice would be, so a client can offer "From home?" / "From <job>?"
        alternatives: [start.kind !== 'home' && homeOf(user) && 'home', start.kind !== 'previousShift' && previous && 'previousShift'].filter(Boolean),
    };

    if (start.kind === 'previousShift' && isSamePlace(previous.job, shift.job)) {
        return { ...base, sameBuilding: true, leaveAt: arriveBy, travelMinutes: 0, lines: [], lateMinutes: 0 };
    }

    const work = coordsOf(shift.job);
    let trip;
    const walk = walkingMinutes(start.place, work);
    if (walk !== null) {
        // A short hop is walked whatever the usual commute is
        trip = { mode: 'WALK', leaveAt: new Date(arriveBy.getTime() - walk * MINUTE_MS), travelMinutes: walk, lines: [] };
    } else if (user.commuteMode === 'DRIVING') {
        const route = await getDrivingRoute(start.place, work);
        if (!route) return null;
        trip = { leaveAt: new Date(arriveBy.getTime() - route.durationMinutes * MINUTE_MS), travelMinutes: route.durationMinutes, lines: [] };
    } else {
        const { itineraries } = await transitService.planTrip({ from: start.place, to: work, time: arriveBy, timeType: 'arrive' });
        const [best] = itineraries;
        if (!best) return null;
        trip = { leaveAt: new Date(best.departure), travelMinutes: best.durationMinutes, lines: linesOf(best) };
    }

    // Can't leave a shift before it ends: then it's "as soon as it ends", and maybe late
    if (start.endsAt && trip.leaveAt < start.endsAt) {
        const arrival = start.endsAt.getTime() + trip.travelMinutes * MINUTE_MS;
        const lateMinutes = Math.max(0, Math.round((arrival - shift.startTime.getTime()) / MINUTE_MS));
        return { ...base, ...trip, leaveAt: start.endsAt, leavesAsShiftEnds: true, lateMinutes };
    }
    return { ...base, ...trip, lateMinutes: 0 };
};

/**
 * Everything the route screen shows: driving and transit to the shift, and the
 * way back home afterwards. Starts from `origin` ({ lat, lng }, the phone's
 * location) when given; otherwise from the `from` choice (see startingPoint).
 * A transit outage doesn't hide driving.
 */
const getShiftRoutes = async (userId, shiftId, { origin = null, from = 'auto' } = {}) => {
    const context = await loadContext(userId, shiftId);
    const { shift, user, previous } = context;
    if (!hasLocation(shift.job)) throw new ApiError(422, 'This job doesn’t have a location yet', { code: 'NO_JOB_LOCATION' });

    const start = origin ? { kind: 'here', name: 'Your location', place: origin } : startingPoint(context, from);
    if (!start) throw new ApiError(422, 'Add your home address or share your location to plan a route', { code: 'NO_ORIGIN' });
    const fromHome = start.kind === 'home';

    const work = coordsOf(shift.job);
    const arriveBy = arriveByFor(shift, user);
    // Within walking distance transit has nothing to say; the walk is the answer
    const walkMinutes = walkingMinutes(start.place, work);

    const [driving, transit] = await Promise.all([
        getDrivingRoute(start.place, work),
        Promise.all([
            transitService.planTrip({ from: start.place, to: work, time: arriveBy, timeType: 'arrive' }),
            // The way back only makes sense from a real home, not wherever the phone is now
            fromHome ? transitService.planTrip({ from: work, to: start.place, time: shift.endTime, timeType: 'depart' }) : { itineraries: [] },
        ])
            .then(([toWork, toHome]) => ({ status: 'ok', toWork: toWork.itineraries, toHome: toHome.itineraries }))
            .catch((err) => ({
                status: 'unavailable',
                message: err instanceof ApiError ? err.message : 'Transit directions are unavailable right now.',
            })),
    ]);

    return {
        fromHome,
        from: describe(start),
        // The shift they come straight from, for the FROM choices (null when there isn't one)
        previousShift: previous ? { name: jobName(previous.job), endsAt: previous.endTime, shiftId: previous.id } : null,
        hasHome: !!homeOf(user),
        origin: start.place,
        destination: work,
        arriveBy,
        arrivalBufferMinutes: user.arrivalBufferMinutes,
        walking: walkMinutes !== null ? { durationMinutes: walkMinutes, leaveBy: new Date(arriveBy.getTime() - walkMinutes * MINUTE_MS) } : null,
        driving: driving && {
            ...driving,
            leaveBy: new Date(arriveBy.getTime() - driving.durationMinutes * MINUTE_MS),
            backHomeAround: fromHome ? new Date(shift.endTime.getTime() + driving.durationMinutes * MINUTE_MS) : null,
        },
        transit,
    };
};

module.exports = { getLeavePlan, getShiftRoutes };
