// Response models — what the API sends back. (Request shapes come from the zod
// validation schemas; see helpers.js.)

const dateTime = { type: 'string', format: 'date-time' };
const nullable = (schema) => ({ ...schema, nullable: true });

const Place = {
    type: 'object',
    properties: {
        address: { type: 'string', example: '164 Breton Avenue, Mississauga, ON' },
        latitude: { type: 'number', example: 43.6113 },
        longitude: { type: 'number', example: -79.6568 },
    },
};

const User = {
    type: 'object',
    properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string' },
        email: { type: 'string', format: 'email' },
        avatarUrl: nullable({ type: 'string' }),
        isEmailVerified: { type: 'boolean' },
        hasPassword: { type: 'boolean', description: 'false for Google/Apple-only accounts' },
        signInMethods: { type: 'object', description: 'Which providers are linked', properties: { google: { type: 'boolean' }, apple: { type: 'boolean' } } },
        taxDeductionPercent: { type: 'number', example: 13 },
        commuteMode: { type: 'string', enum: ['TRANSIT', 'DRIVING'] },
        arrivalBufferMinutes: { type: 'integer', enum: [0, 5, 10, 15], description: 'How early to plan arriving at shifts' },
        homeLocation: nullable({ $ref: '#/components/schemas/Place' }),
    },
};

const AuthResponse = {
    type: 'object',
    properties: {
        user: { $ref: '#/components/schemas/User' },
        accessToken: { type: 'string', description: 'Short-lived JWT — send as `Authorization: Bearer …`' },
        refreshToken: { type: 'string', description: 'Long-lived; trade it at /auth/refresh-token. Stored hashed on the server.' },
    },
};

const Job = {
    type: 'object',
    properties: {
        id: { type: 'string', format: 'uuid' },
        title: { type: 'string', description: 'The role, e.g. "Sales Associate"', example: 'Retail Sales Supervisor' },
        companyName: { type: 'string', description: 'The workplace — the name shown everywhere in the app', example: 'Boathouse' },
        location: nullable({ type: 'string' }),
        latitude: nullable({ type: 'number' }),
        longitude: nullable({ type: 'number' }),
        color: { type: 'string', example: '#8B6BAE' },
        matchKeywords: nullable({ type: 'string', description: 'Comma-separated words that identify this job on a scanned schedule' }),
        hourlyRate: nullable({ type: 'number', example: 17.6 }),
        isActive: { type: 'boolean' },
        userId: { type: 'string', format: 'uuid' },
        createdAt: dateTime,
        updatedAt: dateTime,
    },
};

const Shift = {
    type: 'object',
    properties: {
        id: { type: 'string', format: 'uuid' },
        jobId: { type: 'string', format: 'uuid' },
        startTime: dateTime,
        endTime: { ...dateTime, description: 'After startTime; the next day for overnight shifts' },
        notes: nullable({ type: 'string' }),
        userId: { type: 'string', format: 'uuid' },
        job: { $ref: '#/components/schemas/Job' },
        timeEntries: { type: 'array', description: 'In GET /shifts and GET /shifts/{shiftId} only: the hours clocked for this shift (usually none or one)', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, clockIn: dateTime, clockOut: nullable(dateTime), breakMinutes: { type: 'integer' } } } },
        createdAt: dateTime,
        updatedAt: dateTime,
    },
};

const BulkResult = {
    type: 'object',
    properties: {
        created: { type: 'array', items: { $ref: '#/components/schemas/Shift' } },
        skipped: { type: 'array', description: 'Would have overlapped an existing shift — almost always a duplicate', items: { type: 'object' } },
    },
};

const PaySummary = {
    type: 'object',
    properties: {
        shiftCount: { type: 'integer' },
        totalHours: { type: 'number' },
        completedHours: { type: 'number', description: 'Already worked (shifts split at the current time)' },
        upcomingHours: { type: 'number', description: 'Still on the schedule in this period' },
        totalGrossPay: { type: 'number' },
        totalNetPay: { type: 'number', description: 'Gross minus the user’s tax deduction estimate' },
        taxDeductionPercent: { type: 'number' },
        byJob: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    jobId: { type: 'string' },
                    jobTitle: { type: 'string' },
                    companyName: { type: 'string' },
                    color: { type: 'string' },
                    hourlyRate: nullable({ type: 'number' }),
                    shiftCount: { type: 'integer' },
                    hours: { type: 'number' },
                    grossPay: { type: 'number' },
                },
            },
        },
    },
};

const TravelConflict = {
    type: 'object',
    properties: {
        severity: { type: 'string', enum: ['late', 'tight'], description: 'late = can’t make it; tight = under 5 min to spare' },
        mode: { type: 'string', enum: ['TRANSIT', 'DRIVING'] },
        fromShift: { $ref: '#/components/schemas/Shift' },
        toShift: { $ref: '#/components/schemas/Shift' },
        gapMinutes: { type: 'integer' },
        travelMinutes: { type: 'integer' },
        estimatedArrival: dateTime,
        lateByMinutes: { type: 'integer' },
        slackMinutes: { type: 'integer' },
        leaveBy: nullable({ ...dateTime, description: 'Fix 1: leave the first job by this time (null = no trip makes it)' }),
        earliestStart: { ...dateTime, description: 'Fix 2: when you could actually start the next shift' },
    },
};

const Conflicts = {
    type: 'object',
    properties: {
        overlaps: {
            type: 'array',
            items: {
                type: 'object',
                properties: { first: { $ref: '#/components/schemas/Shift' }, second: { $ref: '#/components/schemas/Shift' } },
            },
        },
        travel: { type: 'array', items: { $ref: '#/components/schemas/TravelConflict' } },
        mode: { type: 'string', enum: ['TRANSIT', 'DRIVING'] },
    },
};

const TransitLeg = {
    type: 'object',
    properties: {
        mode: { type: 'string', example: 'BUS', description: 'WALK, BUS, SUBWAY, TRAM, RAIL, REGIONAL_RAIL, FERRY, …' },
        line: nullable({ type: 'string', example: '35' }),
        lineName: nullable({ type: 'string' }),
        color: nullable({ type: 'string', description: 'The agency’s own line colour' }),
        textColor: nullable({ type: 'string' }),
        agency: nullable({ type: 'string', example: 'MiWay' }),
        headsign: nullable({ type: 'string' }),
        from: { type: 'object', description: '{ name, latitude, longitude, time } — name is null at the trip’s start/end' },
        to: { type: 'object' },
        departure: dateTime,
        arrival: dateTime,
        durationMinutes: { type: 'integer' },
        distanceMeters: nullable({ type: 'integer', description: 'Walking legs only' }),
        stopCount: nullable({ type: 'integer', description: 'Transit legs only' }),
        realTime: { type: 'boolean' },
        geometry: { type: 'array', description: '[lat, lng] points for drawing the leg', items: { type: 'array', items: { type: 'number' } } },
    },
};

const TransitItinerary = {
    type: 'object',
    properties: {
        departure: dateTime,
        arrival: dateTime,
        durationMinutes: { type: 'integer' },
        transfers: { type: 'integer' },
        walkMinutes: { type: 'integer' },
        legs: { type: 'array', items: { $ref: '#/components/schemas/TransitLeg' } },
    },
};

const LeavePlan = {
    type: 'object',
    properties: {
        mode: { type: 'string', enum: ['TRANSIT', 'DRIVING', 'WALK'], description: 'WALK within about 1 km, whatever the usual commute' },
        leaveAt: dateTime,
        arriveBy: { ...dateTime, description: 'Shift start minus the user’s arrival buffer' },
        arrivalBufferMinutes: { type: 'integer' },
        travelMinutes: { type: 'integer' },
        lines: { type: 'array', items: { type: 'string' }, example: ['35', '5'], description: 'Transit lines ridden; empty when driving' },
        from: {
            type: 'object',
            description: 'Where the trip starts',
            properties: {
                kind: { type: 'string', enum: ['previousShift', 'home'] },
                name: { type: 'string', example: 'Boathouse' },
                endsAt: { ...dateTime, description: 'previousShift only: when that shift ends' },
                shiftId: { type: 'string', format: 'uuid' },
            },
        },
        alternatives: { type: 'array', items: { type: 'string', enum: ['home', 'previousShift'] }, description: 'Other starting points that can be asked for with ?from=' },
        sameBuilding: { type: 'boolean', description: 'The shift before is in the same building: no travel, be there by arriveBy' },
        leavesAsShiftEnds: { type: 'boolean', description: 'The gap is shorter than the trip: leave as the shift before ends' },
        lateMinutes: { type: 'integer', description: 'How late the start will be reached (0 = on time)' },
    },
};

const WeatherHour = {
    type: 'object',
    properties: {
        time: { ...dateTime, description: 'Start of the hour (UTC)' },
        temperature: { type: 'number', description: '°C' },
        feelsLike: { type: 'number', description: '°C, with wind and humidity' },
        rainChance: { type: 'integer', description: 'Chance of precipitation, %' },
        precipitationMm: { type: 'number' },
        snowfallCm: { type: 'number' },
        windKmh: { type: 'integer' },
        condition: { type: 'string', enum: ['clear', 'partlyCloudy', 'cloudy', 'fog', 'drizzle', 'freezingRain', 'rain', 'snow', 'thunderstorm'] },
        conditionLabel: { type: 'string', example: 'Partly cloudy' },
        isDay: { type: 'boolean' },
    },
};

const ShiftWeather = {
    type: 'object',
    description: 'Either `status: "ok"` with the fields below, or `status: "unavailable"` with only `reason`.',
    properties: {
        status: { type: 'string', enum: ['ok', 'unavailable'] },
        reason: { type: 'string', enum: ['NO_LOCATION', 'SHIFT_OVER', 'TOO_FAR_AHEAD', 'PROVIDER_DOWN'] },
        place: { type: 'object', properties: { name: { type: 'string' }, source: { type: 'string', enum: ['job', 'home'] } } },
        timeZone: { type: 'string', example: 'America/Toronto', description: 'The place’s own zone' },
        atStart: WeatherHour,
        atEnd: nullable(WeatherHour),
        hours: { type: 'array', items: WeatherHour },
        advice: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    kind: { type: 'string', enum: ['storm', 'ice', 'snow', 'rain', 'cold', 'heat', 'wind', 'fine'] },
                    title: { type: 'string', example: 'Rain likely (70%)' },
                    detail: { type: 'string', example: 'Waterproof jacket or an umbrella.' },
                },
            },
        },
    },
};

const TimeEntry = {
    type: 'object',
    properties: {
        id: { type: 'string', format: 'uuid' },
        jobId: { type: 'string', format: 'uuid' },
        shiftId: nullable({ type: 'string', format: 'uuid', description: 'The scheduled shift it was for, if any' }),
        clockIn: dateTime,
        clockOut: nullable({ ...dateTime, description: 'null while still on the clock' }),
        breakMinutes: { type: 'integer', description: 'Unpaid' },
        paidMinutes: nullable({ type: 'integer', description: 'In timesheet lists only: clocked time minus the break' }),
        job: Job,
    },
};

const Timesheet = {
    type: 'object',
    properties: {
        job: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, companyName: { type: 'string' }, color: { type: 'string' }, hourlyRate: nullable({ type: 'number' }), payFrequency: { type: 'string', enum: ['WEEKLY', 'BIWEEKLY'] }, payday: nullable({ type: 'string', example: '2026-10-23' }) } },
        period: { type: 'object', properties: { start: { type: 'string', example: '2026-10-04' }, end: { type: 'string', example: '2026-10-17', description: 'Last day covered' }, payday: nullable({ type: 'string', example: '2026-10-23' }), offset: { type: 'integer' } } },
        entries: { type: 'array', items: TimeEntry },
        totals: { type: 'object', properties: { entryCount: { type: 'integer' }, paidMinutes: { type: 'integer' }, breakMinutes: { type: 'integer' }, grossPay: nullable({ type: 'number' }) } },
    },
};

const WeekTimesheet = {
    type: 'object',
    properties: {
        period: { type: 'object', properties: { start: { type: 'string', example: '2026-10-04' }, end: { type: 'string', example: '2026-10-10' }, offset: { type: 'integer' } } },
        entries: { type: 'array', items: TimeEntry },
        byJob: { type: 'array', items: { type: 'object', properties: { job: Timesheet.properties.job, entryCount: { type: 'integer' }, paidMinutes: { type: 'integer' }, breakMinutes: { type: 'integer' }, grossPay: nullable({ type: 'number' }) } } },
        totals: { type: 'object', properties: { entryCount: { type: 'integer' }, paidMinutes: { type: 'integer' }, breakMinutes: { type: 'integer' }, grossPay: nullable({ type: 'number' }), missingRates: { type: 'boolean' } } },
    },
};

const ShiftRoutes = {
    type: 'object',
    properties: {
        fromHome: { type: 'boolean' },
        from: { type: 'object', properties: { kind: { type: 'string', enum: ['previousShift', 'home', 'here'] }, name: { type: 'string' } } },
        previousShift: nullable({ type: 'object', properties: { name: { type: 'string' }, endsAt: dateTime, shiftId: { type: 'string', format: 'uuid' } } }),
        hasHome: { type: 'boolean' },
        walking: nullable({ type: 'object', description: 'Within about 1 km', properties: { durationMinutes: { type: 'integer' }, leaveBy: dateTime } }),
        origin: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } },
        destination: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } },
        arriveBy: dateTime,
        arrivalBufferMinutes: { type: 'integer' },
        driving: nullable({
            type: 'object',
            properties: {
                durationMinutes: { type: 'integer' },
                distanceKm: { type: 'number' },
                geometry: { type: 'array', items: { type: 'array', items: { type: 'number' } } },
                leaveBy: dateTime,
                backHomeAround: nullable(dateTime),
            },
        }),
        transit: {
            type: 'object',
            description: '`status: ok` with `toWork` / `toHome` itineraries, or `status: unavailable` with a `message` (driving still works)',
            properties: {
                status: { type: 'string', enum: ['ok', 'unavailable'] },
                toWork: { type: 'array', items: { $ref: '#/components/schemas/TransitItinerary' } },
                toHome: { type: 'array', items: { $ref: '#/components/schemas/TransitItinerary' } },
                message: { type: 'string' },
            },
        },
    },
};

const ScheduleMessage = {
    type: 'object',
    properties: {
        message: { type: 'string', example: 'My shifts · Oct 4 – 10\nMon, Oct 5: 9 AM – 5 PM Boathouse\n\nTotal: 8h' },
        shiftCount: { type: 'integer' },
        totalMinutes: { type: 'integer' },
        startDate: { type: 'string', format: 'date' },
        days: { type: 'integer' },
    },
};

const OutgoingShare = {
    type: 'object',
    properties: {
        id: { type: 'string', format: 'uuid' },
        email: { type: 'string' },
        name: nullable({ type: 'string' }),
        status: { type: 'string', enum: ['active', 'pending'], description: 'pending = that email has no verified account yet' },
        expiresAt: nullable({ ...dateTime, description: 'null = until the owner stops sharing' }),
        createdAt: dateTime,
    },
};

const IncomingShare = {
    type: 'object',
    properties: {
        id: { type: 'string', format: 'uuid' },
        owner: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
        expiresAt: nullable(dateTime),
    },
};

const SharedShift = {
    type: 'object',
    description: 'What a viewer may see of someone else’s shift — no pay, notes or locations',
    properties: {
        id: { type: 'string', format: 'uuid' },
        startTime: dateTime,
        endTime: dateTime,
        job: { type: 'object', properties: { title: { type: 'string' }, companyName: { type: 'string' }, color: { type: 'string' } } },
    },
};

const ExtractedShift = {
    type: 'object',
    properties: {
        startTime: { type: 'string', format: 'date-time', description: 'UTC — the clock time on the schedule, read in the `timeZone` sent with the image' },
        endTime: { type: 'string', format: 'date-time', description: 'UTC. An overnight shift ends the next day' },
        notes: { type: 'string', description: 'Role or position label found next to the shift' },
        suggestedJobId: nullable({ type: 'string', format: 'uuid', description: 'Set when that label matches exactly one of the user’s jobs (workplace, role or match keywords)' }),
        needsReview: { type: 'boolean', description: 'The reader wasn’t sure — the app asks the user to double-check' },
    },
};

const Error = {
    type: 'object',
    properties: {
        success: { type: 'boolean', example: false },
        message: { type: 'string', description: 'Safe to show to the user — never raw internals' },
        details: { description: 'Validation: [{ field, message }]. Some errors carry a `code` (e.g. SHIFT_OVERLAP, NO_JOB_LOCATION).' },
    },
};

module.exports = {
    WeekTimesheet,
    TimeEntry,
    Timesheet,
    ShiftWeather,
    Place,
    User,
    AuthResponse,
    Job,
    Shift,
    BulkResult,
    PaySummary,
    TravelConflict,
    Conflicts,
    TransitLeg,
    TransitItinerary,
    LeavePlan,
    ShiftRoutes,
    ScheduleMessage,
    OutgoingShare,
    IncomingShare,
    SharedShift,
    ExtractedShift,
    Error,
};
