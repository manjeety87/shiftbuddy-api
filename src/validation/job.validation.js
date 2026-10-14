const { z } = require('zod');
const { latitude, longitude } = require('./common.validation');

// A map pin is two numbers; one without the other can't be routed to
const hasWholePin = (job) => (job.latitude == null) === (job.longitude == null);
const PIN_MESSAGE = 'Send both latitude and longitude, or neither';

const jobFields = {
    title: z.string().trim().min(2).max(100),
    companyName: z.string().trim().min(1).max(100),
    location: z.string().trim().max(255).optional(),
    latitude: latitude().optional(),
    longitude: longitude().optional(),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Colour must look like #6366F1').optional(),
    matchKeywords: z.string().trim().max(255).optional(),
    hourlyRate: z.coerce.number().positive('Hourly rate must be more than 0').max(10000).optional(),
    payFrequency: z.enum(['WEEKLY', 'BIWEEKLY']).optional(),
    // Any one payday; pay periods are worked out from it (domain/timesheet.js)
    payday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Payday must look like 2026-10-23').optional(),
};

const createJobSchema = z.object(jobFields).refine(hasWholePin, PIN_MESSAGE);

// Clearing an optional field on an edit: null (or empty text) removes it
const clearableText = (max) => z.string().trim().max(max).nullable().optional().transform((value) => (value === '' ? null : value));

// Update me sab fields optional hain — user shayad sirf ek field change karna chahe.
// Location, keywords and rate can be removed by sending null.
const updateJobSchema = z
    .object({
        title: jobFields.title.optional(),
        companyName: jobFields.companyName.optional(),
        color: jobFields.color,
        location: clearableText(255),
        latitude: z.number().min(-90).max(90).nullable().optional(),
        longitude: z.number().min(-180).max(180).nullable().optional(),
        matchKeywords: clearableText(255),
        hourlyRate: z.number().positive('Hourly rate must be more than 0').max(10000).nullable().optional(),
        payFrequency: jobFields.payFrequency,
        payday: jobFields.payday.nullable(),
    })
    .refine(hasWholePin, PIN_MESSAGE);

module.exports = {
    createJobSchema,
    updateJobSchema,
};
