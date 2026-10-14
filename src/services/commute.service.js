const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const transitService = require('./transit.service');
const { getDrivingRoute } = require('./driving.service');
const { hasLocation, coordsOf } = require('../domain/travel');

// Getting to a shift: when to leave, and how. Lives here (not in the app) so the
// phone app and the web app get the same answers from one place.

const MINUTE_MS = 60 * 1000;

/** The shift (with its job) and the user's commute preferences — 404 if the shift isn't theirs. */
const loadContext = async (userId, shiftId) => {
    const [shift, user] = await Promise.all([
        prisma.shift.findFirst({ where: { id: shiftId, userId }, include: { job: true } }),
        prisma.user.findUnique({
            where: { id: userId },
            select: { homeLatitude: true, homeLongitude: true, commuteMode: true, arrivalBufferMinutes: true },
        }),
    ]);
    if (!shift || !user) throw new ApiError(404, 'Shift not found');
    return { shift, user };
};

const homeOf = (user) => {
    const home = { latitude: user.homeLatitude, longitude: user.homeLongitude };
    return hasLocation(home) ? coordsOf(home) : null;
};

/** The moment to be at work: the shift start minus the user's chosen buffer. */
const arriveByFor = (shift, user) => new Date(shift.startTime.getTime() - user.arrivalBufferMinutes * MINUTE_MS);

const linesOf = (itinerary) => itinerary.legs.filter((leg) => leg.mode !== 'WALK').map((leg) => leg.line).filter(Boolean);

/**
 * When to leave home for a shift, by the user's usual way of getting around.
 * null when it can't be worked out (no home, no job location, no route found).
 */
const getLeavePlan = async (userId, shiftId) => {
    const { shift, user } = await loadContext(userId, shiftId);
    const home = homeOf(user);
    if (!home || !hasLocation(shift.job)) return null;

    const work = coordsOf(shift.job);
    const arriveBy = arriveByFor(shift, user);
    const base = { mode: user.commuteMode, arriveBy, arrivalBufferMinutes: user.arrivalBufferMinutes };

    if (user.commuteMode === 'DRIVING') {
        const route = await getDrivingRoute(home, work);
        if (!route) return null;
        return {
            ...base,
            leaveAt: new Date(arriveBy.getTime() - route.durationMinutes * MINUTE_MS),
            travelMinutes: route.durationMinutes,
            lines: [],
        };
    }

    const { itineraries } = await transitService.planTrip({ from: home, to: work, time: arriveBy, timeType: 'arrive' });
    const [trip] = itineraries;
    if (!trip) return null;
    return { ...base, leaveAt: new Date(trip.departure), travelMinutes: trip.durationMinutes, lines: linesOf(trip) };
};

/**
 * Everything the route screen shows: driving and transit to the shift, and the
 * way back home afterwards. `origin` ({ lat, lng }) plans from there instead of
 * home (e.g. the phone's location). A transit outage doesn't hide driving.
 */
const getShiftRoutes = async (userId, shiftId, origin = null) => {
    const { shift, user } = await loadContext(userId, shiftId);
    if (!hasLocation(shift.job)) throw new ApiError(422, 'This job doesn’t have a location yet', { code: 'NO_JOB_LOCATION' });

    const from = origin ?? homeOf(user);
    if (!from) throw new ApiError(422, 'Add your home address or share your location to plan a route', { code: 'NO_ORIGIN' });
    const fromHome = !origin;

    const work = coordsOf(shift.job);
    const arriveBy = arriveByFor(shift, user);

    const [driving, transit] = await Promise.all([
        getDrivingRoute(from, work),
        Promise.all([
            transitService.planTrip({ from, to: work, time: arriveBy, timeType: 'arrive' }),
            // The way back only makes sense from a real home, not wherever the phone is now
            fromHome ? transitService.planTrip({ from: work, to: from, time: shift.endTime, timeType: 'depart' }) : { itineraries: [] },
        ])
            .then(([toWork, toHome]) => ({ status: 'ok', toWork: toWork.itineraries, toHome: toHome.itineraries }))
            .catch((err) => ({
                status: 'unavailable',
                message: err instanceof ApiError ? err.message : 'Transit directions are unavailable right now.',
            })),
    ]);

    return {
        fromHome,
        origin: from,
        destination: work,
        arriveBy,
        arrivalBufferMinutes: user.arrivalBufferMinutes,
        driving: driving && {
            ...driving,
            leaveBy: new Date(arriveBy.getTime() - driving.durationMinutes * MINUTE_MS),
            backHomeAround: fromHome ? new Date(shift.endTime.getTime() + driving.durationMinutes * MINUTE_MS) : null,
        },
        transit,
    };
};

module.exports = { getLeavePlan, getShiftRoutes };
