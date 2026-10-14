const { z } = require('zod');
const { timeZone } = require('./common.validation');

// Form fields sent alongside the image. The name goes into the prompt that
// reads the schedule, so it's kept short.
const extractShiftsSchema = z.object({
    employeeName: z.string().trim().min(1).max(100).optional(),
    // A schedule shows clock times with no zone; the device's zone turns them into real moments.
    // The default covers app builds from before this field existed (the app launched in Ontario).
    timeZone: timeZone().default('America/Toronto'),
});

module.exports = { extractShiftsSchema };
