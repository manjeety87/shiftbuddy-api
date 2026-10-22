const { z } = require('zod');

// Where a trip to a shift starts. auto: the shift just before it (they're already
// out) when there is one, otherwise home. home / previousShift ask for one of them.
const START_CHOICES = ['auto', 'home', 'previousShift'];
const from = z.enum(START_CHOICES).default('auto').describe('auto (shift just before, else home), home, or previousShift');

// GET /shifts/:shiftId/leave-plan?from=
const leavePlanQuerySchema = z.object({ from });

// GET /shifts/:shiftId/routes — a phone location (fromLat/fromLng) wins over `from`
const routesQuerySchema = z
    .object({
        fromLat: z.coerce.number().min(-90).max(90).optional(),
        fromLng: z.coerce.number().min(-180).max(180).optional(),
        from,
    })
    .refine((q) => (q.fromLat === undefined) === (q.fromLng === undefined), 'Send both fromLat and fromLng, or neither');

module.exports = { leavePlanQuerySchema, routesQuerySchema };
