const express = require('express');
const requireAuth = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const { idParams } = require('../validation/common.validation');
const { clockInSchema, createEntrySchema, updateEntrySchema, timesheetQuerySchema, weekQuerySchema, summaryQuerySchema } = require('../validation/timesheet.validation');
const { getUnlogged, getSummary, getWeekTimesheet, createEntry, getCurrent, clockIn, clockOut, getTimesheet, getEntry, updateEntry, deleteEntry } = require('../controllers/timesheet.controller');

const router = express.Router();
const entryId = idParams('entryId');

router.use(requireAuth);

router.get('/', validate({ query: timesheetQuerySchema }), getTimesheet);
// Literal paths come before /:entryId so they aren't read as an id
router.post('/', validate(createEntrySchema), createEntry);
router.get('/current', getCurrent);
router.get('/unlogged', getUnlogged);
router.get('/week', validate({ query: weekQuerySchema }), getWeekTimesheet);
router.get('/summary', validate({ query: summaryQuerySchema }), getSummary);
router.post('/clock-in', validate(clockInSchema), clockIn);
router.post('/clock-out', clockOut);
router.get('/:entryId', validate({ params: entryId }), getEntry);
router.patch('/:entryId', validate({ params: entryId, body: updateEntrySchema }), updateEntry);
router.delete('/:entryId', validate({ params: entryId }), deleteEntry);

module.exports = router;
