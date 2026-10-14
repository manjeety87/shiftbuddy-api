const ApiError = require('../utils/ApiError');
const env = require('../config/env');
const { createTtlCache } = require('../utils/ttlCache');
const { decodePolyline, pickUseful } = require('../domain/transit');

// Public transport routing via Transitous (https://transitous.org) — a free,
// community-run MOTIS server built on open GTFS feeds (TTC, GO, MiWay, …).
// Their policy asks every client to identify itself and to go easy on
// routing requests, hence the User-Agent and the cache below.
const TRANSITOUS_URL = 'https://api.transitous.org/api/v5/plan';
const USER_AGENT = `ShiftBuddy/1.0 (${env.API_CONTACT_EMAIL})`;
const TIMEOUT_MS = 15000;
// Ask for more than we show, then keep the useful ones (see pickUseful)
const UPSTREAM_ITINERARIES = 10;
// MOTIS caps the walk to the first stop / from the last stop at 15 min by default,
// which hides routes Google Maps happily suggests (20+ min walks in the suburbs).
const MAX_WALK_TO_STOP_SECONDS = 25 * 60;

const UNAVAILABLE = 'Transit directions are unavailable right now. Please try again.';

// Same trip asked twice within a few minutes (re-opening the screen) → one upstream call
const cache = createTtlCache({ ttlMs: 10 * 60 * 1000, maxEntries: 500 });

const toStop = (place, timeKey) => ({
    name: place.name === 'START' || place.name === 'END' ? null : place.name,
    latitude: place.lat,
    longitude: place.lon,
    time: place[timeKey] ?? null,
});

const toLeg = (leg) => {
    const isWalk = leg.mode === 'WALK';
    return {
        mode: leg.mode, // WALK, BUS, SUBWAY, TRAM, RAIL, REGIONAL_RAIL, FERRY, …
        line: isWalk ? null : leg.routeShortName || leg.displayName || null,
        lineName: isWalk ? null : leg.routeLongName || null,
        color: leg.routeColor ? `#${leg.routeColor}` : null,
        textColor: leg.routeTextColor ? `#${leg.routeTextColor}` : null,
        agency: leg.agencyName ?? null,
        headsign: leg.headsign ?? null,
        from: toStop(leg.from, 'departure'),
        to: toStop(leg.to, 'arrival'),
        departure: leg.startTime,
        arrival: leg.endTime,
        durationMinutes: Math.max(1, Math.round(leg.duration / 60)),
        distanceMeters: isWalk && leg.distance != null ? Math.round(leg.distance) : null,
        stopCount: isWalk ? null : (leg.intermediateStops?.length ?? 0) + 1,
        realTime: !!leg.realTime,
        geometry: leg.legGeometry?.points ? decodePolyline(leg.legGeometry.points, leg.legGeometry.precision ?? 6) : [],
    };
};

const toItinerary = (itinerary) => {
    const legs = (itinerary.legs ?? []).map(toLeg);
    return {
        departure: itinerary.startTime,
        arrival: itinerary.endTime,
        durationMinutes: Math.round(itinerary.duration / 60),
        transfers: itinerary.transfers ?? 0,
        walkMinutes: legs.filter((leg) => leg.mode === 'WALK').reduce((sum, leg) => sum + leg.durationMinutes, 0),
        legs,
    };
};

const cacheKey = ({ from, to, time, timeType }) =>
    [from.lat.toFixed(4), from.lng.toFixed(4), to.lat.toFixed(4), to.lng.toFixed(4), time.toISOString(), timeType].join('|');

const fetchItineraries = async ({ from, to, time, timeType }) => {
    const params = new URLSearchParams({
        fromPlace: `${from.lat},${from.lng}`,
        toPlace: `${to.lat},${to.lng}`,
        time: time.toISOString(),
        arriveBy: String(timeType === 'arrive'),
        numItineraries: String(UPSTREAM_ITINERARIES),
        maxPreTransitTime: String(MAX_WALK_TO_STOP_SECONDS),
        maxPostTransitTime: String(MAX_WALK_TO_STOP_SECONDS),
    });

    try {
        const res = await fetch(`${TRANSITOUS_URL}?${params}`, {
            headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) {
            console.error('Transitous error:', res.status, (await res.text()).slice(0, 200));
            throw new ApiError(503, UNAVAILABLE);
        }
        const data = await res.json();
        return (data.itineraries ?? []).map(toItinerary);
    } catch (err) {
        if (err instanceof ApiError) throw err;
        // Unreachable, timed out, or an answer that isn't the JSON we expect
        console.error('Transitous unreachable:', err.message);
        throw new ApiError(503, UNAVAILABLE);
    }
};

/**
 * timeType 'arrive' → trips that get there by `time` (latest departure first);
 * 'depart' → trips leaving after `time` (soonest first).
 */
const planTrip = ({ from, to, time, timeType }) =>
    cache.remember(cacheKey({ from, to, time, timeType }), async () => ({
        itineraries: pickUseful(await fetchItineraries({ from, to, time, timeType }), time, timeType),
    }));

module.exports = { planTrip };
