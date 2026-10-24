const { z } = require('zod');

// Arrive this many minutes before a shift starts (0 = exactly on time). Any whole
// minute is allowed (the apps offer 0/5/10/15 plus Custom); two hours is plenty
// and keeps a typo like 600 from planning a trip the night before.
const ARRIVAL_BUFFER_MAX_MINUTES = 120;

const updateProfileSchema = z.object({
    name: z.string().trim().min(2).max(100).optional(),
    avatarUrl: z.string().trim().url().optional(),
    taxDeductionPercent: z.coerce.number().min(0).max(100).optional(),
    commuteMode: z.enum(['TRANSIT', 'DRIVING']).optional(),
    arrivalBufferMinutes: z.coerce
        .number()
        .int('Use whole minutes')
        .min(0, 'Use 0 minutes or more')
        .max(ARRIVAL_BUFFER_MAX_MINUTES, `Up to ${ARRIVAL_BUFFER_MAX_MINUTES} minutes`)
        .optional(),
});

const homeLocationSchema = z.object({
    address: z.string().trim().min(1, 'Address is required').max(255),
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
});

const verifyEmailSchema = z.object({
    code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from the email'),
});

module.exports = {
    ARRIVAL_BUFFER_MAX_MINUTES,
    verifyEmailSchema,
    updateProfileSchema,
    homeLocationSchema,
};