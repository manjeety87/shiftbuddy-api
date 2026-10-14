const { z } = require('zod');
const { latitude, longitude } = require('./common.validation');

const searchQuerySchema = z
    .object({
        q: z.string().trim().min(3, 'Type at least 3 characters').max(200),
        // Optional "search near here"
        lat: latitude().optional(),
        lng: longitude().optional(),
    })
    .refine((query) => (query.lat === undefined) === (query.lng === undefined), 'Send both lat and lng, or neither');

const reverseQuerySchema = z.object({
    lat: latitude(),
    lng: longitude(),
});

module.exports = { searchQuerySchema, reverseQuerySchema };
