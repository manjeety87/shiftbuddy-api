const { z } = require('zod');

const createShareSchema = z.object({
    email: z.string().trim().email('Enter a valid email address').max(255),
    duration: z.enum(['week', 'month', 'forever']),
});

// GET /shares/:ownerId/shifts?from=&to= — a month at most per request
const MAX_RANGE_DAYS = 62;
const sharedShiftsQuerySchema = z
    .object({ from: z.coerce.date(), to: z.coerce.date() })
    .refine((q) => q.to > q.from, { message: '`to` must be after `from`' })
    .refine((q) => q.to - q.from <= MAX_RANGE_DAYS * 24 * 60 * 60 * 1000, { message: 'Ask for at most two months at a time' });

module.exports = { createShareSchema, sharedShiftsQuerySchema };
