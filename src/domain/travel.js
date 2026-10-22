// Which pairs of shifts need a "can I get there in time?" check. Plain
// functions — the routing calls themselves live in travelConflict.service.

const MINUTE_MS = 60 * 1000;
const EARTH_RADIUS_KM = 6371;
const MAX_GAP_MINUTES = 4 * 60; // a longer break between jobs is never a travel problem
const SAME_PLACE_KM = 0.15; // two jobs this close are effectively the same building/plaza

const hasLocation = (place) => place?.latitude != null && place?.longitude != null;
const coordsOf = (place) => ({ lat: place.latitude, lng: place.longitude });

/** Straight-line (haversine) distance between two `{ lat, lng }` points. */
const distanceKm = (a, b) => {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
};

/**
 * Consecutive shifts (sorted by start, each with its `job`) that mean travelling
 * between two different places within a short gap.
 */
const findTravelPairs = (shifts) => {
    const pairs = [];
    for (let i = 0; i < shifts.length - 1; i++) {
        const first = shifts[i];
        const next = shifts[i + 1];
        const gapMinutes = (next.startTime.getTime() - first.endTime.getTime()) / MINUTE_MS;

        if (gapMinutes < 0) continue; // overlapping — reported by the overlap check instead
        if (gapMinutes > MAX_GAP_MINUTES) continue;
        if (!hasLocation(first.job) || !hasLocation(next.job)) continue;
        if (distanceKm(coordsOf(first.job), coordsOf(next.job)) < SAME_PLACE_KM) continue;

        pairs.push({ first, next, gapMinutes: Math.round(gapMinutes) });
    }
    return pairs;
};

// Closer than this, people walk: transit planners return nothing for a 300 m hop
// and nobody drives across a mall. Streets aren't straight lines, hence the detour factor.
const WALKABLE_KM = 1.2;
const WALK_KM_PER_HOUR = 5;
const WALK_DETOUR = 1.3;

/** Walking minutes between two `{ lat, lng }` points, or null when it's too far to walk. */
const walkingMinutes = (a, b) => {
    const km = distanceKm(a, b);
    if (km > WALKABLE_KM) return null;
    return Math.max(1, Math.round(((km * WALK_DETOUR) / WALK_KM_PER_HOUR) * 60));
};

/** Two places close enough to be the same building or plaza — no travel between them. */
const isSamePlace = (a, b) => distanceKm(coordsOf(a), coordsOf(b)) < SAME_PLACE_KM;

/**
 * The shift someone comes straight from on their way to `shift`: one of their
 * `others` (each with its `job`) that ends at or before it starts, within the same
 * 4-hour window findTravelPairs uses — after a longer break they've likely gone
 * home. The latest one wins. null when there's none, or it has no map pin (then
 * the trip starts from home).
 */
const previousShiftFor = (shift, others) => {
    const candidates = others
        .filter((other) => other.id !== shift.id && other.endTime <= shift.startTime)
        .filter((other) => (shift.startTime.getTime() - other.endTime.getTime()) / MINUTE_MS <= MAX_GAP_MINUTES)
        .sort((a, b) => b.endTime - a.endTime);
    const [previous] = candidates;
    return previous && hasLocation(previous.job) ? previous : null;
};

module.exports = { hasLocation, coordsOf, distanceKm, findTravelPairs, isSamePlace, previousShiftFor, walkingMinutes, MAX_GAP_MINUTES };
