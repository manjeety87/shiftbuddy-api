const ApiError = require('../utils/ApiError');
const env = require('../config/env');
const { createTtlCache } = require('../utils/ttlCache');

// Address lookups go through the backend instead of the phone: both services
// want a proper app User-Agent, and phones can't always set one.
//
// - Search-as-you-type uses Photon (OSM data, free, built for autocomplete).
//   Nominatim's policy forbids autocomplete, so it's only the fallback when
//   Photon is down. https://photon.komoot.io
// - Reverse lookups (tap on the map) use Nominatim.
//   Policy: https://operations.osmfoundation.org/policies/nominatim/
const PHOTON_URL = 'https://photon.komoot.io/api/';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
const SEARCH_LIMIT = 6;
const USER_AGENT = `ShiftBuddy/1.0 (${env.API_CONTACT_EMAIL})`;
const TIMEOUT_MS = 8000;

const UNAVAILABLE = 'Address search is unavailable right now. Please try again.';

// Typing "100 que" then "100 quee" repeats a lot of prefixes across users — a short cache keeps us polite
const searchCache = createTtlCache({ ttlMs: 10 * 60 * 1000, maxEntries: 500 });
// The address of a spot on the map doesn't change from one hour to the next
const reverseCache = createTtlCache({ ttlMs: 24 * 60 * 60 * 1000, maxEntries: 1000 });

const callNominatim = async (path, params) => {
    const url = `${NOMINATIM_URL}${path}?${new URLSearchParams({ format: 'jsonv2', ...params })}`;
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) {
            console.error('Nominatim error:', res.status, (await res.text()).slice(0, 200));
            throw new ApiError(503, UNAVAILABLE);
        }
        return await res.json();
    } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error('Nominatim unreachable:', err.message);
        throw new ApiError(503, UNAVAILABLE);
    }
};

const isCoordinate = (value) => Number.isFinite(value);

/** Only places we can put on a map: an address and two real numbers. */
const usablePlaces = (places) => {
    const seen = new Set();
    return places.filter((place) => place.address && isCoordinate(place.latitude) && isCoordinate(place.longitude) && !seen.has(place.address) && seen.add(place.address));
};

const fromNominatim = (result) => ({
    address: result.display_name,
    latitude: parseFloat(result.lat),
    longitude: parseFloat(result.lon),
});

// "Tim Hortons, 477 Dundas Street West, Toronto, Ontario" — name first, so the list can show it as the title
const photonAddress = (p = {}) => {
    const street = [p.housenumber, p.street].filter(Boolean).join(' ');
    const parts = [p.name, street, p.district, p.city, p.state].filter(Boolean);
    return [...new Set(parts)].join(', ');
};

const searchPhoton = async (query, near) => {
    const params = new URLSearchParams({ q: query, limit: String(SEARCH_LIMIT), lang: 'en' });
    if (near) {
        // Prefer places around the user (their home or the map) without hiding the rest of the world
        params.set('lat', String(near.lat));
        params.set('lon', String(near.lng));
        params.set('zoom', '12');
        params.set('location_bias_scale', '0.1');
    }
    const res = await fetch(`${PHOTON_URL}?${params}`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Photon ${res.status}`);
    const { features = [] } = await res.json();

    return usablePlaces(
        features.map((feature) => ({
            address: photonAddress(feature.properties),
            latitude: feature.geometry?.coordinates?.[1],
            longitude: feature.geometry?.coordinates?.[0],
        }))
    );
};

/** Places matching a partial query, nearest-first when `near` ({ lat, lng }) is given. */
const searchAddress = (query, near) => {
    // ~1 km grid, so nearby users share cache entries
    const nearKey = near ? `${near.lat.toFixed(2)},${near.lng.toFixed(2)}` : '';
    return searchCache.remember(`${query.toLowerCase()}|${nearKey}`, async () => {
        try {
            return await searchPhoton(query, near);
        } catch (err) {
            console.warn('Photon search failed, falling back to Nominatim:', err.message);
            const results = await callNominatim('/search', { q: query, limit: String(SEARCH_LIMIT) });
            return usablePlaces((Array.isArray(results) ? results : []).map(fromNominatim));
        }
    });
};

/** The address at a pin. The pin's own coordinates are kept — the address is only its label. */
const reverseGeocode = async (latitude, longitude) => {
    // ~1 m grid: the same tap asked twice, not a neighbour's address
    const key = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
    const address = await reverseCache.remember(key, async () => {
        const result = await callNominatim('/reverse', { lat: String(latitude), lon: String(longitude) });
        // Middle of a lake etc. — no address, but the pin is still a valid place
        return result?.error || !result?.display_name ? key.replace(',', ', ') : result.display_name;
    });
    return { address, latitude, longitude };
};

module.exports = { searchAddress, reverseGeocode };
