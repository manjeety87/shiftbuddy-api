const { z } = require('zod');

const planQuerySchema = z.object({
    fromLat: z.coerce.number().min(-90).max(90),
    fromLng: z.coerce.number().min(-180).max(180),
    toLat: z.coerce.number().min(-90).max(90),
    toLng: z.coerce.number().min(-180).max(180),
    time: z.coerce.date(),
    timeType: z.enum(['arrive', 'depart']).default('arrive'),
});

module.exports = { planQuerySchema };
