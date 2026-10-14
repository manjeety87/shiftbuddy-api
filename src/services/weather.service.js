const prisma = require('../config/prisma');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const { createTtlCache } = require('../utils/ttlCache');
const { hasLocation, coordsOf } = require('../domain/travel');
const { jobName } = require('../domain/jobLabels');
const { CONDITION_LABELS, conditionOf, weatherForShift } = require('../domain/weather');

// Forecasts from Open-Meteo (https://open-meteo.com): free, no key, 16 days of
// hourly data. Like Transitous it's free for non-commercial use only — switch to
// a paid plan or another provider before the app charges money. Their licence
// (CC BY 4.0) asks for credit; the app shows "Weather by Open-Meteo".
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const USER_AGENT = `ShiftBuddy/1.0 (${env.API_CONTACT_EMAIL})`;
const TIMEOUT_MS = 8000;
const HOURLY_FIELDS = ['temperature_2m', 'apparent_temperature', 'precipitation_probability', 'precipitation', 'snowfall', 'weather_code', 'wind_speed_10m', 'is_day'];

// A forecast moves slowly, and everyone at the same store shares one (~1 km grid)
const cache = createTtlCache({ ttlMs: 30 * 60 * 1000, maxEntries: 500 });

const round1 = (value) => Math.round((value ?? 0) * 10) / 10;

/** Open-Meteo's column-per-field answer → one row per hour (see domain/weather for the shape). */
const toHours = (hourly) =>
    hourly.time.map((unixSeconds, i) => ({
        time: new Date(unixSeconds * 1000),
        temperature: round1(hourly.temperature_2m[i]),
        feelsLike: round1(hourly.apparent_temperature[i]),
        rainChance: hourly.precipitation_probability[i] ?? 0,
        precipitationMm: round1(hourly.precipitation[i]),
        snowfallCm: round1(hourly.snowfall[i]),
        windKmh: Math.round(hourly.wind_speed_10m[i] ?? 0),
        condition: conditionOf(hourly.weather_code[i]),
        isDay: hourly.is_day[i] === 1,
    }));

/** `{ timeZone, hours }` for a place, or null when the provider can't be reached (not cached — the next request asks again). */
const getForecast = ({ lat, lng }) =>
    cache.remember(`${lat.toFixed(2)},${lng.toFixed(2)}`, async () => {
        const params = new URLSearchParams({
            latitude: lat.toFixed(4),
            longitude: lng.toFixed(4),
            hourly: HOURLY_FIELDS.join(','),
            forecast_days: '16',
            timeformat: 'unixtime',
            timezone: 'auto', // only so the answer names the place's zone; the times themselves are unix
        });
        try {
            const res = await fetch(`${FORECAST_URL}?${params}`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
            if (!res.ok) {
                console.error('Open-Meteo error:', res.status, (await res.text()).slice(0, 200));
                return null;
            }
            const data = await res.json();
            if (!Array.isArray(data.hourly?.time)) return null;
            return { timeZone: data.timezone ?? 'UTC', hours: toHours(data.hourly) };
        } catch (err) {
            console.error('Open-Meteo unreachable:', err.message);
            return null;
        }
    });

const unavailable = (reason) => ({ status: 'unavailable', reason });

/**
 * The weather for one of the user's shifts, where the job is (or at home when the
 * job has no pin): at the start and end, hour by hour, and what to wear or bring.
 * `{ status: 'unavailable', reason }` when it can't be told: NO_LOCATION,
 * SHIFT_OVER, TOO_FAR_AHEAD (past the 16-day forecast) or PROVIDER_DOWN.
 */
const getShiftWeather = async (userId, shiftId) => {
    const [shift, user] = await Promise.all([
        prisma.shift.findFirst({ where: { id: shiftId, userId }, include: { job: true } }),
        prisma.user.findUnique({ where: { id: userId }, select: { homeLatitude: true, homeLongitude: true } }),
    ]);
    if (!shift || !user) throw new ApiError(404, 'Shift not found');

    const home = { latitude: user.homeLatitude, longitude: user.homeLongitude };
    const place = hasLocation(shift.job)
        ? { name: jobName(shift.job), source: 'job', coords: coordsOf(shift.job) }
        : hasLocation(home)
            ? { name: 'Home', source: 'home', coords: coordsOf(home) }
            : null;
    if (!place) return unavailable('NO_LOCATION');
    if (shift.endTime <= new Date()) return unavailable('SHIFT_OVER');

    const forecast = await getForecast(place.coords);
    if (!forecast) return unavailable('PROVIDER_DOWN');

    const weather = weatherForShift(forecast.hours, shift, forecast.timeZone);
    if (!weather) return unavailable('TOO_FAR_AHEAD');

    const withLabel = (hour) => hour && { ...hour, conditionLabel: CONDITION_LABELS[hour.condition] };
    return {
        status: 'ok',
        place: { name: place.name, source: place.source },
        timeZone: forecast.timeZone,
        atStart: withLabel(weather.atStart),
        atEnd: withLabel(weather.atEnd),
        hours: weather.hours.map(withLabel),
        advice: weather.advice,
    };
};

module.exports = { getShiftWeather };
