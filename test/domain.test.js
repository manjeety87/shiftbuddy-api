// The server's own zone must never matter: every rule takes the user's zone
// explicitly. Running in Toronto time makes a hidden dependency show up.
process.env.TZ = 'America/Toronto';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const { findOverlapPairs, splitByOverlap, planShiftCopies, summarizeShifts } = require('../src/domain/shifts');
const { createShiftSchema, updateShiftSchema } = require('../src/validation/shift.validation');
const { createJobSchema, updateJobSchema } = require('../src/validation/job.validation');
const { distanceKm, findTravelPairs, isSamePlace, previousShiftFor, walkingMinutes } = require('../src/domain/travel');
const { rangeIn, buildScheduleMessage } = require('../src/domain/scheduleMessage');
const { jobName } = require('../src/domain/jobLabels');

const TORONTO = 'America/Toronto';
const at = (iso) => DateTime.fromISO(iso, { zone: TORONTO }).toJSDate();
const localTime = (date) => DateTime.fromJSDate(date, { zone: TORONTO }).toFormat("yyyy-MM-dd'T'HH:mm");

const boathouse = { title: 'Sales Associate', companyName: 'Boathouse', color: '#111111', hourlyRate: 18, latitude: 43.6532, longitude: -79.3832 };
const cafe = { title: 'Barista', companyName: 'Cafe', color: '#222222', hourlyRate: null, latitude: 43.7001, longitude: -79.4163 };
const shift = (id, start, end, job = boathouse, jobId = 'job-1') => ({ id, jobId, job, startTime: at(start), endTime: at(end), notes: null });

test('overlaps: back-to-back shifts are fine, shared time is a pair', () => {
    const morning = shift('a', '2026-10-05T09:00', '2026-10-05T13:00');
    const afternoon = shift('b', '2026-10-05T13:00', '2026-10-05T17:00');
    const clash = shift('c', '2026-10-05T16:00', '2026-10-05T20:00');

    assert.deepEqual(findOverlapPairs([morning, afternoon]), []);
    assert.deepEqual(findOverlapPairs([clash, afternoon, morning]), [{ first: afternoon, second: clash }]);
});

test('overlaps: one long shift pairs with every shift inside it', () => {
    const allDay = shift('a', '2026-10-05T08:00', '2026-10-05T22:00');
    const lunch = shift('b', '2026-10-05T12:00', '2026-10-05T13:00');
    const evening = shift('c', '2026-10-05T18:00', '2026-10-05T21:00');
    assert.equal(findOverlapPairs([allDay, lunch, evening]).length, 2);
});

test('copy by offset: 9:00 stays 9:00 across the end of daylight saving (Nov 1, 2026)', () => {
    const original = shift('a', '2026-10-28T09:00', '2026-10-28T17:00');
    const [copy] = planShiftCopies([original], { offsetDays: 7, timeZone: TORONTO });

    assert.equal(localTime(copy.startTime), '2026-11-04T09:00');
    assert.equal(localTime(copy.endTime), '2026-11-04T17:00');
    // A plain "+7 × 24h" would have landed at 8:00
    assert.equal(copy.startTime.getTime() - original.startTime.getTime(), (7 * 24 + 1) * 60 * 60 * 1000);
});

test('copy onto dates: a selection keeps its spacing and overnight shifts still end the next day', () => {
    const monday = shift('a', '2026-10-05T09:00', '2026-10-05T17:00');
    const wednesdayNight = shift('b', '2026-10-07T22:00', '2026-10-08T06:00');
    const copies = planShiftCopies([wednesdayNight, monday], { targetDates: ['2026-10-12', '2026-10-19'], timeZone: TORONTO });

    assert.deepEqual(copies.map((c) => [localTime(c.startTime), localTime(c.endTime)]), [
        ['2026-10-12T09:00', '2026-10-12T17:00'],
        ['2026-10-14T22:00', '2026-10-15T06:00'],
        ['2026-10-19T09:00', '2026-10-19T17:00'],
        ['2026-10-21T22:00', '2026-10-22T06:00'],
    ]);
    assert.deepEqual(planShiftCopies([], { offsetDays: 7, timeZone: TORONTO }), []);
});

test('summary: hours, pay and the worked/upcoming split at "now"', () => {
    const paid = shift('a', '2026-10-05T09:00', '2026-10-05T17:00');
    const unpaid = shift('b', '2026-10-06T10:00', '2026-10-06T12:30', cafe, 'job-2');
    const summary = summarizeShifts([paid, unpaid], { taxPercent: 13, now: at('2026-10-05T13:00').getTime() });

    assert.equal(summary.shiftCount, 2);
    assert.equal(summary.totalHours, 10.5);
    assert.equal(summary.completedHours, 4);
    assert.equal(summary.upcomingHours, 6.5);
    assert.equal(summary.totalGrossPay, 144);
    assert.equal(summary.totalNetPay, 125.28);
    assert.deepEqual(summary.byJob.map((j) => [j.jobId, j.shiftCount, j.hours, j.grossPay]), [['job-1', 1, 8, 144], ['job-2', 1, 2.5, 0]]);
});

test('summary: no shifts is all zeros, not NaN', () => {
    const summary = summarizeShifts([], { taxPercent: 13 });
    assert.deepEqual([summary.totalHours, summary.completedHours, summary.upcomingHours, summary.totalGrossPay, summary.totalNetPay], [0, 0, 0, 0, 0]);
});

test('travel pairs: only nearby-in-time shifts at different, known places', () => {
    const first = shift('a', '2026-10-05T09:00', '2026-10-05T13:00');
    const acrossTown = shift('b', '2026-10-05T13:30', '2026-10-05T17:00', cafe, 'job-2');
    const sameBuilding = shift('c', '2026-10-05T17:15', '2026-10-05T20:00', { ...cafe, latitude: 43.7002 }, 'job-3');
    const nextDay = shift('d', '2026-10-06T09:00', '2026-10-06T13:00');
    const noPin = shift('e', '2026-10-06T13:30', '2026-10-06T17:00', { ...cafe, latitude: null }, 'job-4');

    const pairs = findTravelPairs([first, acrossTown, sameBuilding, nextDay, noPin]);
    assert.deepEqual(pairs.map((p) => [p.first.id, p.next.id, p.gapMinutes]), [['a', 'b', 30]]);

    const km = distanceKm({ lat: 43.6532, lng: -79.3832 }, { lat: 43.7001, lng: -79.4163 });
    assert.ok(km > 5.5 && km < 6.5, `expected about 6 km, got ${km}`);
});

test('leave from the shift just before: latest one within 4 hours, with a pin', () => {
    const next = shift('n', '2026-10-21T17:30', '2026-10-21T21:00', cafe, 'job-2');
    const boathouse = shift('b', '2026-10-21T09:00', '2026-10-21T17:30');
    const morning = shift('m', '2026-10-21T06:00', '2026-10-21T08:00');
    assert.equal(previousShiftFor(next, [morning, boathouse, next])?.id, 'b'); // the latest wins, itself is ignored
    assert.equal(previousShiftFor(next, [morning])?.id, undefined); // ended 9.5 hours before: they went home
    assert.equal(previousShiftFor(next, [shift('x', '2026-10-21T10:00', '2026-10-21T13:30')])?.id, 'x'); // exactly 4 hours: still counts
    assert.equal(previousShiftFor(next, [{ ...boathouse, job: { ...boathouse.job, latitude: null } }]), null); // no pin: from home
    assert.equal(previousShiftFor(next, [shift('o', '2026-10-21T16:00', '2026-10-21T18:00')]), null); // overlapping: not before it
    assert.equal(previousShiftFor(next, []), null);

    assert.ok(isSamePlace(cafe, { ...cafe, latitude: 43.7002 }));
    // ~260 m across a mall is a few minutes' walk; across town is not walkable
    const walk = walkingMinutes({ lat: 43.6544, lng: -79.3807 }, { lat: 43.6567, lng: -79.3814 });
    assert.ok(walk >= 3 && walk <= 6, `expected a short walk, got ${walk}`);
    assert.equal(walkingMinutes({ lat: 43.6532, lng: -79.3832 }, { lat: 43.7001, lng: -79.4163 }), null);
    assert.ok(!isSamePlace(cafe, boathouse.job));
});

test('schedule message: weeks start on Sunday in the user’s zone', () => {
    const wednesday = DateTime.fromISO('2026-10-07T23:30', { zone: TORONTO });
    assert.equal(rangeIn('thisWeek', TORONTO, wednesday).start.toISODate(), '2026-10-04');
    assert.equal(rangeIn('nextWeek', TORONTO, wednesday).start.toISODate(), '2026-10-11');
    assert.deepEqual([rangeIn('thisMonth', TORONTO, wednesday).start.toISODate(), rangeIn('thisMonth', TORONTO, wednesday).days], ['2026-10-01', 31]);
    // 11:30 PM Wednesday in Toronto is already Thursday in UTC — still the same week here
    assert.equal(rangeIn('thisWeek', TORONTO, wednesday.toUTC()).start.toISODate(), '2026-10-04');
});

test('schedule message: compact times, workplace names, days off and the total', () => {
    const start = DateTime.fromISO('2026-10-04', { zone: TORONTO });
    const shifts = [
        shift('a', '2026-10-05T09:00', '2026-10-05T17:00'),
        shift('b', '2026-10-05T17:30', '2026-10-05T21:00', cafe, 'job-2'),
        shift('c', '2026-10-09T22:00', '2026-10-10T06:00'),
    ];
    const { message, totalMinutes } = buildScheduleMessage(shifts, { start, days: 7, nameStyle: 'workplace', includeDaysOff: false });

    assert.equal(message, [
        'My shifts · Oct 4 – 10',
        'Mon, Oct 5: 9 AM – 5 PM Boathouse · 5:30 – 9 PM Cafe',
        'Fri, Oct 9: 10 PM – 6 AM Boathouse',
        '',
        'Total: 19.5h',
    ].join('\n'));
    assert.equal(totalMinutes, 1170);

    const withOff = buildScheduleMessage([], { start, days: 7, nameStyle: 'job', includeDaysOff: true }).message.split('\n');
    assert.equal(withOff.length, 9); // header + 7 days off + "free" line
    assert.equal(withOff[1], 'Sun, Oct 4: Off');
});

test('job name: the workplace, or the role when there is none', () => {
    assert.equal(jobName(boathouse), 'Boathouse');
    assert.equal(jobName({ title: 'Tutor', companyName: '  ' }), 'Tutor');
});

const { normalizeScannedShifts, suggestJobId } = require('../src/domain/scannedShifts');

test('scanned shifts: clock times are read in the user’s zone, whatever the server’s is', () => {
    const [shift] = normalizeScannedShifts([{ startTime: '2026-10-05T09:00', endTime: '2026-10-05T17:30', needsReview: false }], TORONTO);
    assert.deepEqual([shift.startTime, shift.endTime, shift.needsReview], ['2026-10-05T13:00:00.000Z', '2026-10-05T21:30:00.000Z', false]);

    // A stray "Z" or offset from the reader must not move the time
    const [withZ] = normalizeScannedShifts([{ startTime: '2026-10-05T09:00:00Z', endTime: '2026-10-05T17:30:00-07:00', needsReview: false }], TORONTO);
    assert.equal(withZ.startTime, shift.startTime);
    assert.equal(withZ.endTime, shift.endTime);

    // Same photo scanned in Vancouver is three hours later in UTC
    assert.equal(normalizeScannedShifts([{ startTime: '2026-10-05T09:00', endTime: '2026-10-05T17:30' }], 'America/Vancouver')[0].startTime, '2026-10-05T16:00:00.000Z');
});

test('scanned shifts: overnight ends the next day and is flagged; unreadable entries are dropped', () => {
    const result = normalizeScannedShifts([
        { startTime: '2026-10-09T22:00', endTime: '2026-10-09T06:00', needsReview: false, notes: '  Closing  ' },
        { startTime: 'Friday', endTime: '2026-10-09T06:00', needsReview: false },
        { startTime: '2026-10-09T10:00' },
        null,
    ], TORONTO);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0], { startTime: '2026-10-10T02:00:00.000Z', endTime: '2026-10-10T10:00:00.000Z', notes: 'Closing', needsReview: true });
    assert.deepEqual(normalizeScannedShifts(undefined, TORONTO), []);
});

test('suggested job: only when the label matches exactly one job', () => {
    const jobs = [
        { id: 'a', companyName: 'Boathouse', title: 'Sales Associate', matchKeywords: 'BHR, 070' },
        { id: 'b', companyName: 'Fairweather', title: 'Sales Associate', matchKeywords: null },
    ];
    assert.equal(suggestJobId({ notes: 'Key holder — BHR' }, jobs), 'a');
    assert.equal(suggestJobId({ notes: 'fairweather floor' }, jobs), 'b');
    assert.equal(suggestJobId({ notes: 'Sales Associate' }, jobs), null); // both stores
    assert.equal(suggestJobId({ notes: 'Stock room' }, jobs), null);
    assert.equal(suggestJobId({}, jobs), null);
});

test('bulk add: clashes with existing shifts or earlier ones in the batch are skipped', () => {
    const existing = [shift('x', '2026-10-05T09:00', '2026-10-05T13:00')];
    const backToBack = shift('a', '2026-10-05T13:00', '2026-10-05T17:00');
    const clashesExisting = shift('b', '2026-10-05T12:00', '2026-10-05T14:00');
    const clashesBatch = shift('c', '2026-10-05T16:00', '2026-10-05T20:00');
    const free = shift('d', '2026-10-06T09:00', '2026-10-06T17:00');

    const { accepted, skipped } = splitByOverlap([backToBack, clashesExisting, clashesBatch, free], existing);
    assert.deepEqual(accepted.map((s) => s.id), ['a', 'd']);
    assert.deepEqual(skipped.map((s) => s.id), ['b', 'c']);
    assert.equal(existing.length, 1); // the caller's list isn't touched
});

test('shift input: times must be in order and at most 24 hours; empty notes mean none', () => {
    const jobId = '11111111-1111-4111-8111-111111111111';
    const parse = (schema, body) => schema.safeParse(body);

    assert.equal(parse(createShiftSchema, { jobId, startTime: '2026-10-05T13:00:00Z', endTime: '2026-10-05T21:00:00Z' }).success, true);
    assert.equal(parse(createShiftSchema, { jobId, startTime: '2026-10-05T21:00:00Z', endTime: '2026-10-05T13:00:00Z' }).success, false);
    // The classic typo: right time, wrong day
    const wrongDay = parse(createShiftSchema, { jobId, startTime: '2026-10-05T13:00:00Z', endTime: '2026-10-08T21:00:00Z' });
    assert.match(wrongDay.error.issues[0].message, /24 hours/);
    assert.equal(parse(createShiftSchema, { jobId, endTime: '2026-10-05T21:00:00Z' }).success, false);

    assert.equal(parse(updateShiftSchema, { notes: '   ' }).data.notes, null);
    assert.equal(parse(updateShiftSchema, { notes: null }).data.notes, null);
    assert.equal(parse(updateShiftSchema, { notes: ' Closing ' }).data.notes, 'Closing');
    assert.equal('notes' in parse(updateShiftSchema, { endTime: '2026-10-05T21:00:00Z' }).data && parse(updateShiftSchema, { endTime: '2026-10-05T21:00:00Z' }).data.notes !== undefined, false);
});

test('job input: a pin is both numbers or neither; an edit can clear rate, keywords and place', () => {
    assert.equal(createJobSchema.safeParse({ title: 'Barista', companyName: 'Cafe', latitude: 43.6 }).success, false);
    assert.equal(createJobSchema.safeParse({ title: 'Barista', companyName: 'Cafe', latitude: 43.6, longitude: -79.4 }).success, true);
    assert.equal(createJobSchema.safeParse({ title: 'Barista', companyName: 'Cafe', hourlyRate: 0 }).success, false);

    const cleared = updateJobSchema.safeParse({ hourlyRate: null, matchKeywords: '', location: null, latitude: null, longitude: null });
    assert.deepEqual(cleared.data, { hourlyRate: null, matchKeywords: null, location: null, latitude: null, longitude: null });
    assert.equal(updateJobSchema.safeParse({ latitude: null, longitude: -79.4 }).success, false);
    assert.deepEqual(updateJobSchema.safeParse({ title: 'Lead' }).data, { title: 'Lead' });
});

const { decodePolyline, pickUseful } = require('../src/domain/transit');
const { createTtlCache } = require('../src/utils/ttlCache');
const { mapWithLimit } = require('../src/utils/mapWithLimit');

const trip = (departure, arrival, lines) => ({
    departure: at(departure).toISOString(),
    arrival: at(arrival).toISOString(),
    durationMinutes: Math.round((at(arrival) - at(departure)) / 60000),
    legs: [{ mode: 'WALK', line: null }, ...lines.map((line) => ({ mode: 'BUS', line }))],
});

test('transit: one entry per route, latest departure first when arriving by a time', () => {
    const deadline = at('2026-10-05T09:00');
    const options = [
        trip('2026-10-05T07:50', '2026-10-05T08:40', ['35', '5']),
        trip('2026-10-05T08:05', '2026-10-05T08:55', ['35', '5']), // same route, later: this one is kept
        trip('2026-10-05T08:08', '2026-10-05T08:58', ['97']), // a different route keeps its place
        trip('2026-10-05T05:00', '2026-10-05T06:00', ['12']), // three hours early: not a real choice
        trip('2026-10-05T07:00', '2026-10-05T08:50', ['300']), // more than 1.5× the fastest
    ];
    const picked = pickUseful(options, deadline, 'arrive');
    assert.deepEqual(picked.map((i) => [localTime(new Date(i.departure)).slice(11), i.legs.at(-1).line]), [['08:08', '97'], ['08:05', '5']]);
    assert.deepEqual(pickUseful([], deadline, 'arrive'), []);
});

test('transit: leaving after a time puts the soonest arrival first, and keeps it even if slow', () => {
    const leaveAt = at('2026-10-05T17:00');
    const soonestButSlow = trip('2026-10-05T17:00', '2026-10-05T18:10', ['1']);
    const quickLater = trip('2026-10-05T17:40', '2026-10-05T18:20', ['2']);
    const picked = pickUseful([quickLater, soonestButSlow], leaveAt, 'depart');
    assert.equal(picked[0], soonestButSlow); // travel-conflict checks read the first one
    assert.equal(picked.length, 2);
});

test('polyline: decodes the reference example', () => {
    // From the polyline format's documentation, precision 5
    assert.deepEqual(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5), [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
    assert.deepEqual(decodePolyline(''), []);
});

test('cache: remembers, shares one load between callers, retries after a failure or an empty answer', async () => {
    const cache = createTtlCache({ ttlMs: 1000, maxEntries: 2 });
    let loads = 0;
    const load = async () => { loads++; await new Promise((resolve) => setTimeout(resolve, 10)); return `value ${loads}`; };

    const [a, b] = await Promise.all([cache.remember('k', load), cache.remember('k', load)]);
    assert.deepEqual([a, b, loads], ['value 1', 'value 1', 1]);
    assert.equal(await cache.remember('k', load), 'value 1');

    await assert.rejects(cache.remember('bad', async () => { throw new Error('down'); }), /down/);
    assert.equal(await cache.remember('bad', async () => 'back up'), 'back up');
    assert.equal(await cache.remember('none', async () => null), null);
    assert.equal(await cache.remember('none', async () => 'now known'), 'now known');

    // Only two fit: the oldest ("k") has been pushed out
    assert.equal(cache.get('k'), undefined);

    const quick = createTtlCache({ ttlMs: 5, maxEntries: 5 });
    quick.set('x', 1);
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(quick.get('x'), undefined);
});

test('mapWithLimit: keeps order and never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    const doubled = await mapWithLimit([5, 1, 4, 2, 3, 6, 7], 3, async (n) => {
        peak = Math.max(peak, ++running);
        await new Promise((resolve) => setTimeout(resolve, n * 3));
        running--;
        return n * 2;
    });
    assert.deepEqual(doubled, [10, 2, 8, 4, 6, 12, 14]);
    assert.equal(peak, 3);
    assert.deepEqual(await mapWithLimit([], 3, async () => 1), []);
});

const { conditionOf, weatherForShift } = require('../src/domain/weather');

// 24 hourly rows from 2026-10-05 00:00 Toronto; `over` changes chosen hours
const forecast = (over = {}) => Array.from({ length: 24 }, (_, hour) => ({
    time: at(`2026-10-05T${String(hour).padStart(2, '0')}:00`),
    temperature: 15, feelsLike: 15, rainChance: 0, precipitationMm: 0, snowfallCm: 0, windKmh: 10, condition: 'clear', isDay: hour >= 7 && hour < 19,
    ...(typeof over === 'function' ? over(hour) : over),
}));
const dayShift = { startTime: at('2026-10-05T09:00'), endTime: at('2026-10-05T17:00') };
const kinds = (weather) => weather.advice.map((item) => item.kind);

test('weather: covers an hour each side of the shift; null past the end of the forecast', () => {
    const weather = weatherForShift(forecast(), dayShift, TORONTO);
    assert.equal(localTime(weather.hours[0].time), '2026-10-05T08:00');
    assert.equal(localTime(weather.hours.at(-1).time), '2026-10-05T17:00');
    assert.equal(localTime(weather.atStart.time), '2026-10-05T09:00');
    assert.equal(weatherForShift(forecast(), { startTime: at('2026-10-20T09:00'), endTime: at('2026-10-20T17:00') }, TORONTO), null);
    assert.deepEqual([conditionOf(0), conditionOf(63), conditionOf(75), conditionOf(96), conditionOf(1234)], ['clear', 'rain', 'snow', 'thunderstorm', 'cloudy']);
});

test('weather advice: mild day needs nothing; rain, cold and heat each say what to bring', () => {
    assert.deepEqual(weatherForShift(forecast({ feelsLike: 20 }), dayShift, TORONTO).advice.map((a) => a.title), ['Nothing special needed']);

    const rainy = weatherForShift(forecast((h) => (h === 12 ? { rainChance: 80, precipitationMm: 3, condition: 'rain' } : {})), dayShift, TORONTO);
    assert.equal(rainy.advice[0].title, 'Rain likely (80%)');
    assert.match(rainy.advice[0].detail, /umbrella/);

    const windyRain = weatherForShift(forecast({ rainChance: 70, precipitationMm: 2, windKmh: 55 }), dayShift, TORONTO);
    assert.match(windyRain.advice[0].detail, /too windy for an umbrella/);
    assert.equal(kinds(windyRain).includes('wind'), false); // already said in the rain advice

    assert.equal(weatherForShift(forecast({ rainChance: 35 }), dayShift, TORONTO).advice[0].title, 'Might rain (35%)');
    assert.match(weatherForShift(forecast({ feelsLike: -25 }), dayShift, TORONTO).advice[0].title, /Extreme cold, feels like -25°/);
    assert.match(weatherForShift(forecast({ feelsLike: 5 }), dayShift, TORONTO).advice[0].detail, /jacket or a hoodie/);
    assert.match(weatherForShift(forecast({ feelsLike: 34 }), dayShift, TORONTO).advice[0].detail, /water bottle/);
});

test('weather advice: snow beats rain, ice and storms come first, at most four items', () => {
    const snowy = weatherForShift(forecast({ feelsLike: -10, rainChance: 90, precipitationMm: 4, snowfallCm: 1, condition: 'snow' }), dayShift, TORONTO);
    assert.deepEqual(kinds(snowy), ['snow', 'cold']);
    assert.match(snowy.advice[0].title, /Heavy snow, about 10 cm/);

    const everything = weatherForShift(forecast((h) => ({ feelsLike: h === 17 ? -12 : -2, snowfallCm: 0.3, windKmh: 60, condition: h === 10 ? 'thunderstorm' : h === 11 ? 'freezingRain' : 'snow' })), dayShift, TORONTO);
    assert.deepEqual(kinds(everything).slice(0, 2), ['storm', 'ice']);
    assert.equal(everything.advice.length, 4);
});

test('weather advice: a much colder trip home is called out with the time', () => {
    const coolsDown = weatherForShift(forecast((h) => ({ feelsLike: h >= 17 ? 9 : 18 })), dayShift, TORONTO);
    const tripHome = coolsDown.advice.find((item) => item.title.startsWith('Colder on the way home'));
    assert.equal(tripHome.title, 'Colder on the way home (9° at 5:00 PM)');
});

const { autoBreakMinutes, paidMinutes, payPeriodOn, summarizeEntries } = require('../src/domain/timesheet');
const period = (dateISO, job, offset) => {
    const p = payPeriodOn(at(dateISO), job, TORONTO, offset);
    return [p.start.toISODate(), p.end.minus({ days: 1 }).toISODate(), p.payday?.toISODate() ?? null];
};

test('pay period: the two full weeks before the week a payday falls in', () => {
    const job = { payFrequency: 'BIWEEKLY', payday: '2026-10-23' }; // a Friday; that week starts Sun Oct 18
    assert.deepEqual(period('2026-10-10T12:00', job), ['2026-10-04', '2026-10-17', '2026-10-23']);
    assert.deepEqual(period('2026-10-04T00:00', job), ['2026-10-04', '2026-10-17', '2026-10-23']); // first minute of the period
    assert.deepEqual(period('2026-10-17T23:59', job), ['2026-10-04', '2026-10-17', '2026-10-23']); // last minute
    assert.deepEqual(period('2026-10-18T00:00', job), ['2026-10-18', '2026-10-31', '2026-11-06']); // next period, next payday
    assert.deepEqual(period('2026-10-10T12:00', job, -1), ['2026-09-20', '2026-10-03', '2026-10-09']);
    // Any payday of the same rhythm gives the same periods — it doesn't have to be the latest one
    assert.deepEqual(period('2026-10-10T12:00', { payFrequency: 'BIWEEKLY', payday: '2026-08-28' }), ['2026-10-04', '2026-10-17', '2026-10-23']);
});

test('pay period: weekly jobs, the clock change, and no payday yet', () => {
    assert.deepEqual(period('2026-10-10T12:00', { payFrequency: 'WEEKLY', payday: '2026-10-16' }), ['2026-10-04', '2026-10-10', '2026-10-16']);
    // Nov 1, 2026 has 25 hours in Toronto: the period still ends on a Saturday
    assert.deepEqual(period('2026-11-03T09:00', { payFrequency: 'BIWEEKLY', payday: '2026-10-23' }), ['2026-11-01', '2026-11-14', '2026-11-20']);
    // No payday yet: still two whole Sunday–Saturday weeks around the date, and no payday claimed
    assert.deepEqual(period('2026-10-10T12:00', { payFrequency: 'BIWEEKLY', payday: null }), ['2026-09-27', '2026-10-10', null]);
    // A late-evening Toronto time is already the next day in UTC — still Saturday's period here
    assert.equal(payPeriodOn(new Date('2026-10-18T03:30:00Z'), { payFrequency: 'BIWEEKLY', payday: '2026-10-23' }, TORONTO).start.toISODate(), '2026-10-04');
});

test('timesheet: 30 unpaid minutes once past 5 hours; paid time and pay add up', () => {
    const entry = (start, end, breakMinutes) => ({ clockIn: at(start), clockOut: end ? at(end) : null, breakMinutes });
    assert.equal(autoBreakMinutes(at('2026-10-05T09:00'), at('2026-10-05T14:00')), 0); // exactly 5 h: no break needed yet
    assert.equal(autoBreakMinutes(at('2026-10-05T09:00'), at('2026-10-05T14:01')), 30);
    assert.equal(paidMinutes(entry('2026-10-05T09:00', '2026-10-05T17:00', 30)), 450);
    assert.equal(paidMinutes(entry('2026-10-05T09:00', null, 0)), null);

    const { entries, totals } = summarizeEntries([
        entry('2026-10-05T09:00', '2026-10-05T17:00', 30), // 7.5 h
        entry('2026-10-06T22:00', '2026-10-07T02:00', 0), // overnight, 4 h
        entry('2026-10-07T09:00', null, 0), // still working: listed, not counted
    ], 18);
    assert.deepEqual(entries.map((e) => e.paidMinutes), [450, 240, null]);
    assert.deepEqual(totals, { entryCount: 2, paidMinutes: 690, breakMinutes: 30, grossPay: 207 });
    assert.equal(summarizeEntries([], null).totals.grossPay, null);
});
