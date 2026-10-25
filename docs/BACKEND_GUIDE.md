# ShiftBuddy backend — guide

How the API is built, why it's built that way, and how to add to it without
breaking the rules. For what each endpoint does, open the live reference:

- **Swagger UI:** `http://<host>:<port>/api/docs`. Every route has its purpose,
  inputs, outputs and errors. Use **Authorize** to paste a token and try it.
- **Raw OpenAPI JSON:** `/api/docs.json`. Import it into Postman or Insomnia, or
  generate a typed client for the web app.

Docs are on in development. In production they're off unless `API_DOCS=true`.

---

## 1. The one rule: the backend owns the logic

The phone app and the coming web app must give the same answers. So anything that
is a rule, a calculation, or a call to an outside service lives here, once:

| Concern | Where |
| --- | --- |
| Overlap check, travel-time conflicts | `domain/shifts.js#findOverlapPairs`, `domain/travel.js`; `travelConflict.service.js`, `conflict.service.js` |
| Leave-by time, arrival buffer, routes | `services/commute.service.js` |
| Timesheet: pay periods, unpaid breaks, paid time | `domain/timesheet.js` (rules), `services/timesheet.service.js` |
| Weather for a shift, what to wear or bring | `domain/weather.js` (rules), `services/weather.service.js` (Open-Meteo, non-commercial) |
| Copying shifts (time zones, DST) | `domain/shifts.js#planShiftCopies` (used by `shift.service.js#copyShifts`) |
| Schedule text message | `domain/scheduleMessage.js` (used by `scheduleMessage.service.js`) |
| Pay summary | `domain/shifts.js#summarizeShifts` (used by `shift.service.js#getShiftsSummary`) |
| Reading schedules (Gemini) | `services/ocr.service.js` |
| Transit / driving / places | `transit.service.js`, `driving.service.js`, `geocode.service.js` |

Clients fetch results and format them for display. What stays on the device on
purpose:
- local notifications (reminders, wake-up alarms),
- instant form feedback (e.g. the 3-hour-rule hint while typing),
- pure display helpers.

## 2. Folder map

```
src/
  server.js            starts the HTTP server
  app.js               middleware, route mounting, docs, error handler (order matters)
  routes/              URL → middleware → controller. No logic.
  controllers/         read req, call one service, send ApiResponse. No business rules.
  services/            use cases: load from the database / outside services, call domain, save
  domain/              the rules as pure functions (overlaps, copy planning, pay summary,
                       travel pairs, schedule message). No database, no Express — this is
                       the code the web app can share. Tested in test/ (npm test).
  pdf/                 documents drawn with pdfkit (the shift statement); data comes in
                       ready-made from domain/, nothing here decides a number
  validation/          zod schemas (also the source of the API docs' request shapes)
  constants/           plain values shared by schemas and services
  middleware/          auth (JWT), validate, rate limiters, OCR usage limit, notFound
  utils/               ApiError, ApiResponse, asyncHandler, errorHandler, jobLabels, token
  config/              env (validated settings), prisma client, multer (uploads)
  docs/                OpenAPI: helpers.js (builders), components.js (response models),
                       paths/*.js (one file per area), openapi.js (assembles it)
prisma/                schema.prisma + migrations/
scripts/check-api-docs.js   fails if a route has no docs (npm run docs:check)
```

## 3. Life of a request

```
request
  → helmet (security headers) → cors → express.json (10 MB limit)
  → router: requireAuth (JWT) → rate limiter → validate({ params, query, body })
  → controller (asyncHandler catches throws)
  → service (rules, Prisma, outside calls)
  → controller: res.status(..).json(new ApiResponse(status, data, message))
  → on any throw: errorHandler → { success: false, message, details? }
```

## 4. Conventions

**Responses**
- Success: `new ApiResponse(status, data, message)`, which sends
  `{ statusCode, data, message, success }`.
- Created: use 201. "Nothing to return": `data: null`.
- Expected failures: `throw new ApiError(status, userSafeMessage, details?)`.
  - `message` is shown to users as-is: plain words, no stack traces, no
    Gemini/Prisma/provider text.
  - Machine-readable reasons go in `details.code`, e.g. `SHIFT_OVERLAP`,
    `NO_JOB_LOCATION`, `NO_ORIGIN`.
- Unexpected failures are logged and answered with a generic 500. A database that
  can't be reached answers 503.

**Validation**
- Everything is checked on the route with one middleware:
  `validate(bodySchema)` or `validate({ params, query, body })`.
  - The cleaned body (trimmed, lowercased email, defaults) replaces `req.body`.
  - Cleaned params and query land on `req.validated.params` / `req.validated.query`
    (Express 5 makes `req.query` read-only). Controllers never parse by hand.
  - Ids use `idParams('shiftId')` from `validation/common.validation.js`: a
    malformed id is a 400 and never reaches the database.
  - On failure: 400, `message` = the first problem, `details` = every field.
- Every input gets a zod schema, including optional query params, ids and dates.
  Those schemas are also what the docs show.
- Validation and `constants/` files import only zod/luxon — no services, no
  database — so they can be shared with the web app as they are.

**Settings**
- `config/env.js` is the only file that reads `process.env`. It validates at
  startup and stops the server with the names of what's wrong. Everything else
  does `const env = require('../config/env')`.

**Ownership and privacy**
- Every query is scoped by `userId`. When something isn't yours, answer
  **404, not 403**, so ids can't be probed. (`assertCanView` for shares,
  `findFirst({ where: { id, userId } })` elsewhere.)
- Shared schedules expose times and workplace only: no pay, notes or locations.
  Who may read one is decided in one place, `viewableGrantWhere` in
  `share.service.js`: not revoked, not expired, and addressed to a viewer whose
  email is verified. Build Prisma conditions with `AND: [a, b]` — spreading two
  objects that both have an `OR` drops one of them.
- Never print or commit secrets or the database URL (logs included).

**Writing shifts**
- Anything that checks the schedule and then writes (`createShift`, `updateShift`,
  `createShiftsBulk`) runs inside `withScheduleLock(userId, work)` in
  `shift.service.js`: one transaction, one request per user at a time. Use the
  `tx` it hands you for every query inside.
- Limits live in `constants/shifts.js`: a shift is at most 24 hours, a bulk request
  100 shifts, a list 1000 rows (soonest first).
- New shifts only go on active jobs. Deleting a job hides it and deletes its
  shifts that haven't started; past shifts keep it.
- On an edit, `null` (or empty text) clears an optional field: shift `notes`, job
  `location`/`latitude`/`longitude`, `matchKeywords`, `hourlyRate`. Leaving a field
  out means "don't change it".

**Time**
- Store and send UTC ISO timestamps.
- When local days matter (copying, "this week", messages), the client sends its
  IANA `timeZone`. Work in that zone with **luxon**, so 9:00 stays 9:00 across
  DST and a 10 PM shift isn't put on the next day.
- Weeks start on Sunday (matches the app's calendar).

**Outside services**
- Only called from services, each with:
  - a `User-Agent` that names the app and contact (`API_CONTACT_EMAIL`),
  - a timeout (`AbortSignal.timeout`),
  - a cache from `utils/ttlCache.js` — `cache.remember(key, load)`; callers asking
    for the same thing at once share one call, failures aren't cached,
  - a per-user rate limit on every route that can reach it (including
    `/shifts/conflicts`),
  - `mapWithLimit` when one request needs several calls (travel checks: 3 at a time).
- The caches and rate limits live in this process's memory. With more than one
  server, move both to Redis.
- Failing providers degrade gracefully: OCR tries the next Gemini model, place
  search falls back to Nominatim, and routes still return driving when transit
  is down.
- Transitous is volunteer-run and only for non-commercial use. Switch providers
  before charging money.

**Style**
- Comments explain *why* (a decision, a trap), not what the next line does.
- No dead or commented-out code: delete it (git remembers).
- Small, named functions; one service function per use case.

## 5. Adding an endpoint (checklist)

1. **Schema:** add a zod schema in `validation/<area>.validation.js`.
2. **Service:** write the logic in `services/<area>.service.js`. Scope it by
   `userId`, throw `ApiError` with a user-safe message, and keep it testable
   (pure helpers where possible).
3. **Controller:** add `asyncHandler(async (req, res) => …)` in
   `controllers/<area>.controller.js`. Parse, call the service, respond. Nothing
   else.
4. **Route:** add it in `routes/<area>.routes.js` with auth, a rate limit if it
   calls an outside service, and validation. Literal paths (`/summary`) go
   before `/:id`.
5. **Docs:** add the operation in `docs/paths/<area>.js` with `op({ … })`.
   - `summary`: what it does. `description`: why it exists, limits, side effects.
   - List the errors it can return.
   - Add a response model to `docs/components.js` if it's new.
6. **Check:** `npm run docs:check` must pass.
7. **Test:** run against the real database with a throwaway `@test.local` user,
   and delete it afterwards. Cover the happy path, other users' data (404),
   validation and the edge cases (DST, overnight shifts, duplicates).
8. **Database:** schema change? Add a migration folder with the SQL, run
   `prisma migrate deploy` against the **direct** URL (the pooled URL without
   `-pooler`), then `prisma generate`.

## 6. Security checklist (already in place; keep it that way)

- Passwords: bcrypt. A new password (change or reset) signs out every device.
- Sessions: one row per device in `sessions`. Refresh tokens are SHA-256 hashed and
  swapped on every refresh; presenting an already-swapped token ends that session.
  Signing out ends only the device that asked.
- Browsers never see the refresh token: with `X-Auth-Transport: cookie` it travels
  as an httpOnly cookie scoped to `/api/auth` (`utils/refreshCookie.js`). The header
  is also the CSRF guard — another site can't send it without passing CORS.
- Emailed codes (verify email, reset password; `utils/oneTimeCode.js`): hashed,
  10-minute expiry, 5 attempts, constant-time compare.
- Google/Apple sign-in onto an email whose account was never verified takes the
  account over (old password and sessions removed): the first registrant never
  proved they own the address.
- Rate limits (all defined in `middleware/rateLimiter.js`; counted per user when
  signed in, per IP otherwise — set `TRUST_PROXY=1` behind a host's proxy):
  - sign-in routes: 20 / 15 min
  - code / password-reset emails: 5 / 15 min
  - token refresh: 60 / 15 min
  - routing: 20–30 / min
  - place search: 90 / min
  - share invites: 30 / hour
  - schedule scans (paid Gemini calls): 30 / hour
- Tokens are signed and verified as HS256 only.
- `forgot-password` answers the same whether or not the email exists.
- Uploads: memory only, JPEG/PNG/WEBP, 10 MB max. Images are never stored.
- helmet headers on every response. CORS allows the origins in `CORS_ORIGIN`
  (comma-separated) with credentials; empty or `*` means any origin, which is for
  development only (the server warns at startup in production). The mobile app
  sends no Origin, so CORS doesn't apply to it.
- Unknown URLs answer 404 JSON; bad JSON 400; oversized bodies and images 413.

## 7. Environment variables (names only; values live in `.env`)

| Name | Used for |
| --- | --- |
| `DATABASE_URL` | Neon Postgres (pooled URL at runtime) |
| `PORT`, `NODE_ENV` | server |
| `TRUST_PROXY` | reverse-proxy hops in front of the server (0 locally, 1 on most hosts) |
| `CORS_ORIGIN` | web origins allowed to call the API, comma-separated |
| `COOKIE_SAMESITE` | `lax` (default; web app and API on the same site) or `none` (different sites) |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRY`, `JWT_REFRESH_EXPIRY` | tokens |
| `GOOGLE_CLIENT_ID`, `APPLE_BUNDLE_ID` | social sign-in |
| `GEMINI_API_KEY`, `GEMINI_MODELS` (or `GEMINI_MODEL`) | schedule reading; model fallback order |
| `RESEND_API_KEY` | email codes |
| `API_CONTACT_EMAIL` | User-Agent for the open-data services |
| `API_DOCS` | `true` to serve /api/docs outside development |
| `RATE_LIMIT_SCALE` | multiplies every rate limit (local browser tests sign in many accounts from one IP); ignored in production |

## 8. Scripts

| Command | What |
| --- | --- |
| `npm run dev` | start with nodemon |
| `npm start` | start |
| `npm test` | unit tests for `domain/` (node's built-in runner, Toronto time) |
| `npm run docs:check` | every route documented, nothing stale |
| `npm run prisma:generate` | regenerate the Prisma client |
| `npm run prisma:studio` | browse the database |
