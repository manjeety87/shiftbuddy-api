// Choosing which transit trips to show, and reading route lines. Plain
// functions on our own itinerary shape — the provider calls are in transit.service.
//
// An itinerary here is `{ departure, arrival (ISO), durationMinutes, legs: [{ mode, line }] }`.

// Three is what a person can compare at a glance; more turned the route screen into a list to scroll
const MAX_ITINERARIES = 3;
// Options that get there much earlier than needed (or leave much later) aren't real choices
const TIME_WINDOW_MIN = 45;
// A trip taking much longer than the fastest one isn't worth showing, even with fewer transfers
const MAX_SLOWDOWN = 1.5;

/** Google-style encoded polyline → [[lat, lng], …]. Transitous uses 6 decimal places. */
const decodePolyline = (encoded, precision = 6) => {
    const factor = 10 ** precision;
    const points = [];
    let index = 0;
    let lat = 0;
    let lng = 0;

    while (index < encoded.length) {
        for (const axis of ['lat', 'lng']) {
            let result = 0;
            let shift = 0;
            let byte;
            do {
                byte = encoded.charCodeAt(index++) - 63;
                result |= (byte & 0x1f) << shift;
                shift += 5;
            } while (byte >= 0x20);
            const delta = result & 1 ? ~(result >> 1) : result >> 1;
            if (axis === 'lat') lat += delta;
            else lng += delta;
        }
        points.push([lat / factor, lng / factor]);
    }
    return points;
};

const minutesBetween = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 60000;

// "35>5", "103>MI>31" — which lines a trip rides, ignoring the walks
const routeSignature = (itinerary) => itinerary.legs.filter((leg) => leg.mode !== 'WALK').map((leg) => leg.line ?? leg.mode).join('>');

/**
 * A routing search returns a broad set over a long window — the same few routes
 * at several departure times, plus trips that get there hours early. Show what a
 * person actually chooses between, like a maps app does:
 *  1. close to the requested time (arrive: arrival near the deadline; depart: leaving soon after),
 *  2. not far slower than the fastest option,
 *  3. one entry per route — its best time — so different routes get a place.
 *     (No "strictly better" pruning: someone's usual 35 → 5 must not vanish because
 *     another route leaves 3 minutes later with the same walking.)
 * Ordered like a maps app: arrive → leave as late as possible; depart → get there soonest.
 */
const pickUseful = (itineraries, time, timeType) => {
    if (itineraries.length === 0) return [];

    const anchor = timeType === 'arrive' ? (i) => i.arrival : (i) => i.departure;
    const nearby = itineraries.filter((i) => minutesBetween(anchor(i), time.toISOString()) <= TIME_WINDOW_MIN);
    // Nothing near the time (rural routes, night) → still show the closest options
    const near = nearby.length > 0 ? nearby : itineraries;
    const fastest = Math.min(...near.map((i) => i.durationMinutes));

    // "Better" in time: leaving later when arriving by a deadline, arriving sooner when leaving after a time
    const timeScore = timeType === 'arrive' ? (i) => Date.parse(i.departure) : (i) => -Date.parse(i.arrival);
    const bestScore = Math.max(...near.map(timeScore));
    const bestPerRoute = new Map();
    near
        // The best-timed trip always stays, even if slow: travel-conflict checks rely on
        // the soonest arrival / latest departure being first
        .filter((i) => i.durationMinutes <= fastest * MAX_SLOWDOWN || timeScore(i) === bestScore)
        .forEach((i) => {
            const signature = routeSignature(i);
            const kept = bestPerRoute.get(signature);
            if (!kept || timeScore(i) > timeScore(kept)) bestPerRoute.set(signature, i);
        });

    return [...bestPerRoute.values()].sort((a, b) => timeScore(b) - timeScore(a)).slice(0, MAX_ITINERARIES);
};

module.exports = { decodePolyline, pickUseful };
