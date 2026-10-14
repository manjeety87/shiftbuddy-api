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

module.exports = { hasLocation, coordsOf, distanceKm, findTravelPairs };
