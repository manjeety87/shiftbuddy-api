const { z } = require('zod');
const { IANAZone } = require('luxon');

// Pieces every area's schemas share. Pure zod — no database, no Express — so the
// same file can move into the shared contracts package for the web app.

const uuid = (message = 'Invalid id') => z.string().uuid(message);

/** `{ shiftId: uuid }` for a route like `/:shiftId` — a malformed id is a 400, never a database query. */
const idParams = (...names) => z.object(Object.fromEntries(names.map((name) => [name, uuid()])));

const latitude = () => z.coerce.number().min(-90).max(90);
const longitude = () => z.coerce.number().min(-180).max(180);

// A date-time in a query string; zod's default message ("expected date, received Date") reads like a bug
const queryDate = () => z.coerce.date({ error: 'Use an ISO date, e.g. 2026-10-12 or 2026-10-12T09:00:00Z' });

// IANA zone from the device ("America/Toronto") — day boundaries and DST follow it
const timeZone = () => z.string().refine((zone) => IANAZone.isValidZone(zone), 'Unknown time zone');

module.exports = { uuid, idParams, latitude, longitude, queryDate, timeZone };
