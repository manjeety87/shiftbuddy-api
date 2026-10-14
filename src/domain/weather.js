// Weather for a shift, and what to wear or bring because of it. Plain functions
// on hourly forecast rows — the forecast itself is fetched in weather.service.
//
// An hour is `{ time: Date, temperature, feelsLike (°C), rainChance (%),
// precipitationMm, snowfallCm, windKmh, condition, isDay }`.

const HOUR_MS = 60 * 60 * 1000;
const MAX_HOURS_SHOWN = 16;
const MAX_ADVICE = 4;

// WMO weather codes (what Open-Meteo and most forecast services use) → our few conditions
const CONDITION_BY_CODE = [
    [[0], 'clear'],
    [[1, 2], 'partlyCloudy'],
    [[3], 'cloudy'],
    [[45, 48], 'fog'],
    [[51, 53, 55], 'drizzle'],
    [[56, 57, 66, 67], 'freezingRain'],
    [[61, 63, 65, 80, 81, 82], 'rain'],
    [[71, 73, 75, 77, 85, 86], 'snow'],
    [[95, 96, 99], 'thunderstorm'],
];

const CONDITION_LABELS = {
    clear: 'Clear',
    partlyCloudy: 'Partly cloudy',
    cloudy: 'Cloudy',
    fog: 'Foggy',
    drizzle: 'Drizzle',
    freezingRain: 'Freezing rain',
    rain: 'Rain',
    snow: 'Snow',
    thunderstorm: 'Thunderstorms',
};

const conditionOf = (code) => CONDITION_BY_CODE.find(([codes]) => codes.includes(code))?.[1] ?? 'cloudy';

/** The forecast row covering `date`, or null when the forecast doesn't reach it. */
const hourAt = (hours, date) => {
    const target = date.getTime();
    return hours.find((hour) => target >= hour.time.getTime() && target < hour.time.getTime() + HOUR_MS) ?? null;
};

const degrees = (value) => `${Math.round(value)}°`;
const clock = (date, timeZone) => date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone });

/**
 * What to wear or bring, most important first (at most four). Looks at every
 * hour the person is out for — the trip there, the shift, the trip back — because
 * a mild afternoon start can be a freezing walk home at night.
 *
 * Each item: `{ kind, title, detail }`; `kind` picks the icon in the app.
 */
const adviceFor = (hours, { atStart, atEnd, timeZone }) => {
    const coldest = Math.min(...hours.map((hour) => hour.feelsLike));
    const hottest = Math.max(...hours.map((hour) => hour.feelsLike));
    const rainChance = Math.max(...hours.map((hour) => hour.rainChance));
    const rainMm = hours.reduce((sum, hour) => sum + hour.precipitationMm, 0);
    const snowCm = hours.reduce((sum, hour) => sum + hour.snowfallCm, 0);
    const wind = Math.max(...hours.map((hour) => hour.windKmh));
    const has = (condition) => hours.some((hour) => hour.condition === condition);
    const snowing = snowCm >= 0.5 || has('snow');

    const advice = [];
    const add = (kind, title, detail) => advice.push({ kind, title, detail });

    if (has('thunderstorm')) add('storm', 'Thunderstorms possible', 'Take a waterproof jacket and leave a little early — transit often runs late in storms.');
    if (has('freezingRain')) add('ice', 'Icy out there', 'Freezing rain makes sidewalks slippery. Shoes with grip, and give yourself extra time.');

    if (snowing) {
        add('snow', snowCm >= 5 ? `Heavy snow, about ${Math.round(snowCm)} cm` : 'Snow on the way', 'Waterproof boots and a warm coat. Keep a dry pair of socks or shoes for work.');
    } else if (rainChance >= 50 || rainMm >= 1) {
        add('rain', `Rain likely (${Math.round(rainChance)}%)`, wind >= 40 ? 'Waterproof jacket with a hood — too windy for an umbrella.' : 'Waterproof jacket or an umbrella.');
    } else if (rainChance >= 30) {
        add('rain', `Might rain (${Math.round(rainChance)}%)`, 'A small umbrella in your bag is enough.');
    }

    if (coldest <= -20) add('cold', `Extreme cold, feels like ${degrees(coldest)}`, 'Heavy winter coat, hat, gloves and a scarf. Cover your face — skin freezes fast.');
    else if (coldest <= -8) add('cold', `Very cold, feels like ${degrees(coldest)}`, 'Winter coat, hat and gloves.');
    else if (coldest <= 2) add('cold', `Cold, feels like ${degrees(coldest)}`, 'Winter jacket. Gloves help while you wait for the bus.');
    else if (coldest <= 10) add('cold', `Chilly, feels like ${degrees(coldest)}`, 'A jacket or a hoodie.');
    else if (coldest <= 16 && hottest < 26) add('cold', `Cool, feels like ${degrees(coldest)}`, 'A light jacket or long sleeves.');

    if (hottest >= 32) add('heat', `Very hot, feels like ${degrees(hottest)}`, 'Light clothes, a full water bottle and sunscreen.');
    else if (hottest >= 26) add('heat', `Warm, feels like ${degrees(hottest)}`, 'Light clothes and a bottle of water.');

    if (wind >= 40 && !advice.some((item) => item.kind === 'rain')) add('wind', `Windy, gusts near ${Math.round(wind)} km/h`, 'A windproof layer; tie back anything loose.');

    // Dressed for the start, caught out at the end
    if (atEnd && atStart.feelsLike - atEnd.feelsLike >= 7) {
        add('cold', `Colder on the way home (${degrees(atEnd.feelsLike)} at ${clock(atEnd.time, timeZone)})`, 'Bring an extra layer for the trip back.');
    }

    if (advice.length === 0) add('fine', 'Nothing special needed', 'Comfortable weather — dress as you like.');
    return advice.slice(0, MAX_ADVICE);
};

/**
 * The weather around one shift: at its start, at its end, hour by hour from an
 * hour before to an hour after (the commute both ways), and the advice.
 * null when the forecast doesn't reach the shift's start. `timeZone` is the
 * place's own zone, used only to word times inside the advice.
 */
const weatherForShift = (hours, { startTime, endTime }, timeZone) => {
    const atStart = hourAt(hours, startTime);
    if (!atStart) return null;

    const from = startTime.getTime() - HOUR_MS;
    const to = endTime.getTime() + HOUR_MS;
    const around = hours.filter((hour) => hour.time.getTime() + HOUR_MS > from && hour.time.getTime() < to).slice(0, MAX_HOURS_SHOWN);
    const atEnd = hourAt(hours, endTime);

    return {
        atStart,
        atEnd,
        hours: around,
        advice: adviceFor(around, { atStart, atEnd, timeZone }),
    };
};

module.exports = { CONDITION_LABELS, conditionOf, hourAt, adviceFor, weatherForShift };
