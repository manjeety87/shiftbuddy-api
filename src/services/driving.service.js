// Driving routes via OSRM's public demo server (free, no key, car profile only).
const env = require('../config/env');
const { createTtlCache } = require('../utils/ttlCache');

const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving';
const USER_AGENT = `ShiftBuddy/1.0 (${env.API_CONTACT_EMAIL})`;
const TIMEOUT_MS = 10000;

// Job and home locations rarely move, so a route is kept for a day
const cache = createTtlCache({ ttlMs: 24 * 60 * 60 * 1000, maxEntries: 2000 });

const keyOf = (from, to) => `${from.lat.toFixed(4)},${from.lng.toFixed(4)}|${to.lat.toFixed(4)},${to.lng.toFixed(4)}`;

const fetchRoute = async (from, to) => {
    try {
        // OSRM wants lng,lat
        const res = await fetch(`${OSRM_URL}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`, {
            headers: { 'User-Agent': USER_AGENT },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) return null;
        const data = await res.json();
        const best = data.routes?.[0];
        if (data.code !== 'Ok' || !best) return null;

        return {
            durationMinutes: Math.ceil(best.duration / 60),
            distanceKm: Math.round(best.distance / 100) / 10,
            geometry: (best.geometry?.coordinates ?? []).map(([lng, lat]) => [lat, lng]),
        };
    } catch (err) {
        console.error('OSRM unreachable:', err.message);
        return null;
    }
};

/**
 * { durationMinutes, distanceKm, geometry: [[lat, lng], …] } by car, or null if
 * OSRM can't route it / is unreachable (callers treat that as "unknown"; a null
 * isn't cached, so the next request asks again).
 */
const getDrivingRoute = (from, to) => cache.remember(keyOf(from, to), () => fetchRoute(from, to));

/** Minutes by car, or null when unknown. */
const getDrivingMinutes = async (from, to) => (await getDrivingRoute(from, to))?.durationMinutes ?? null;

module.exports = { getDrivingRoute, getDrivingMinutes };
