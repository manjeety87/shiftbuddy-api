const sharp = require('sharp');
const { GoogleGenAI } = require('@google/genai');
const { DateTime } = require('luxon');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const env = require('../config/env');
const { normalizeScannedShifts, suggestJobId } = require('../domain/scannedShifts');

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

// Free-tier Gemini models get "high demand" 503s that come and go per model, so
// instead of waiting on one busy model we fall through to the next. Override
// the order with GEMINI_MODELS (comma-separated); GEMINI_MODEL still works for one.
const DEFAULT_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'];
const configuredModels = env.GEMINI_MODELS.length > 0 ? env.GEMINI_MODELS : [env.GEMINI_MODEL].filter(Boolean);
const GEMINI_MODELS = configuredModels.length > 0 ? configuredModels : DEFAULT_MODELS;
const BUSY_STATUS = new Set([429, 500, 503]);
const GONE_STATUS = new Set([404]); // model retired for this key — just skip it
const SECOND_PASS_DELAY_MS = 3000;
const SECOND_PASS_MODELS = 2; // after a short pause, retry the best two once more

const isBusy = (err) => BUSY_STATUS.has(err.status) || /UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded/i.test(err.message || '');

const shiftExtractionSchema = {
    type: 'object',
    properties: {
        shifts: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    startTime: { type: 'string', description: 'Local wall-clock time, YYYY-MM-DDTHH:mm, no time zone' },
                    endTime: { type: 'string', description: 'Local wall-clock time, YYYY-MM-DDTHH:mm, no time zone' },
                    notes: { type: 'string' },
                    needsReview: { type: 'boolean' },
                },
                required: ['startTime', 'endTime', 'needsReview'],
            },
        },
    },
    required: ['shifts'],
};

const buildPrompt = (employeeName, timeZone) => {
    // The user's "today", not the server's — at 9 PM in Toronto it's already tomorrow in UTC
    const today = DateTime.now().setZone(timeZone).toISODate();

    return `You are looking at a work schedule — it could be a clean digital screenshot, or a handwritten/photographed paper schedule (possibly rotated, low quality, or a grid/table with multiple employees).

Today's date is ${today} — use this to resolve dates that don't include a year, or a week-ending/week-starting date shown in a header, to figure out the correct calendar dates for each day.

IMPORTANT — only extract shifts for this specific employee: "${employeeName}"
- The schedule may list multiple employees (e.g. in a grid where rows are employee names and columns are days of the week). If so, find the row that matches "${employeeName}" (allow partial matches, nicknames, and handwriting variations — e.g. "Manjeet" should match "Manjeety", "Mann", etc.) and ONLY extract shifts from that row. Completely ignore all other employees.
- If the schedule is for a single employee already (no name grid), extract all shifts normally.
- If you cannot confidently identify which row/shifts belong to "${employeeName}", return an empty shifts array rather than guessing and returning someone else's shifts.

The image may be rotated (sideways or upside down) — read it in whatever orientation makes the text legible, regardless of how the image is physically oriented.

For grid-style schedules, cell values like "11-6" or "6-9" are shorthand for start-end times. Use context (typical retail/service work hours) to infer AM/PM correctly (e.g. "11-6" is usually 11:00 AM-6:00 PM, "6-9" as an evening entry is usually 6:00 PM-9:00 PM).

For each shift, extract:
- startTime and endTime exactly as the clock times on the schedule, formatted YYYY-MM-DDTHH:mm in 24-hour time (for example 2026-10-05T17:30). Do NOT add a time zone, an offset or a "Z", and do NOT convert the times.
- a shift that runs past midnight ends on the next calendar date
- notes: any role/position label near the shift, if present (otherwise omit)
- needsReview: true if you are not fully confident about the date, time, or that this shift belongs to "${employeeName}"

If the image contains no readable schedule, or no shifts for "${employeeName}", return an empty shifts array.`;
};

/** Try each model in order; a busy or retired model moves on to the next one instead of waiting. */
const generateWithFallback = async (request) => {
    const passes = [GEMINI_MODELS, GEMINI_MODELS.slice(0, SECOND_PASS_MODELS)];
    let sawBusy = false;

    for (let pass = 0; pass < passes.length; pass++) {
        if (pass > 0) {
            if (!sawBusy) break; // nothing was merely busy — another pass won't help
            await new Promise((resolve) => setTimeout(resolve, SECOND_PASS_DELAY_MS));
        }
        for (const model of passes[pass]) {
            try {
                const response = await ai.models.generateContent({ ...request, model });
                if (model !== GEMINI_MODELS[0] || pass > 0) console.info(`OCR served by ${model}`);
                return response;
            } catch (err) {
                if (isBusy(err)) {
                    sawBusy = true;
                    console.warn(`OCR model ${model} busy (${err.status ?? 'n/a'}), trying the next one`);
                    continue;
                }
                if (GONE_STATUS.has(err.status)) {
                    console.warn(`OCR model ${model} not available for this key, skipping`);
                    continue;
                }
                console.error(`OCR model ${model} failed:`, err.message);
                throw new ApiError(502, 'Could not process the image right now — please try again');
            }
        }
    }
    throw new ApiError(503, 'The schedule reader is busy right now — please try again in a minute');
};

/**
 * The shifts for `employeeName` in a photo or screenshot of a schedule, as UTC
 * times worked out in the user's `timeZone`, each with a suggested job when the
 * label next to it matches exactly one of theirs. Nothing is saved.
 */
const extractShiftsFromImage = async (userId, imageBuffer, { employeeName, timeZone }) => {
    const processedImage = await sharp(imageBuffer)
        .rotate() // auto-orient based on the photo's EXIF data — fixes sideways phone photos
        .resize({ width: 1600, withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();

    const base64Image = processedImage.toString('base64');

    const request = {
        contents: [
            {
                role: 'user',
                parts: [
                    { text: buildPrompt(employeeName, timeZone) },
                    { inlineData: { data: base64Image, mimeType: 'image/jpeg' } },
                ],
            },
        ],
        config: {
            responseMimeType: 'application/json',
            responseSchema: shiftExtractionSchema,
        },
    };

    const [response, jobs] = await Promise.all([
        generateWithFallback(request),
        prisma.job.findMany({ where: { userId, isActive: true }, select: { id: true, companyName: true, title: true, matchKeywords: true } }),
    ]);

    let parsed;
    try {
        parsed = JSON.parse(response.text);
    } catch {
        throw new ApiError(502, 'Received an unreadable response while processing the image');
    }

    return normalizeScannedShifts(parsed.shifts, timeZone).map((shift) => ({ ...shift, suggestedJobId: suggestJobId(shift, jobs) }));
};

module.exports = { extractShiftsFromImage };