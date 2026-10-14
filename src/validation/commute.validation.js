const { z } = require('zod');

// Optional starting point; without it routes start from the user's home
const routesQuerySchema = z
    .object({
        fromLat: z.coerce.number().min(-90).max(90).optional(),
        fromLng: z.coerce.number().min(-180).max(180).optional(),
    })
    .refine((q) => (q.fromLat === undefined) === (q.fromLng === undefined), 'Send both fromLat and fromLng, or neither');

module.exports = { routesQuerySchema };
