const express = require('express');
const shiftController = require('../controllers/shift.controller');
const { getLeavePlan, getShiftRoutes } = require('../controllers/commute.controller');
const requireAuth = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const { getShiftWeather } = require('../controllers/weather.controller');
const { commuteLimiter, weatherLimiter, statementLimiter } = require('../middleware/rateLimiter');
const { idParams } = require('../validation/common.validation');
const { leavePlanQuerySchema, routesQuerySchema } = require('../validation/commute.validation');
const { createShiftSchema, bulkCreateShiftsSchema, copyShiftsSchema, updateShiftSchema, shiftFilterQuerySchema, travelConflictsQuerySchema, scheduleMessageQuerySchema, markMissedSchema, statementQuerySchema } = require('../validation/shift.validation');

const router = express.Router();
const { getStatement, createShift, createShiftsBulk, copyShifts, getConflicts, getScheduleMessage, getTravelConflicts, getMyShifts, getShiftById, updateShift, deleteShift, markMissed, clearMissed, getShiftsSummary } = shiftController;
const shiftId = idParams('shiftId');

router.use(requireAuth);

router.post('/', validate(createShiftSchema), createShift);
router.post('/bulk', validate(bulkCreateShiftsSchema), createShiftsBulk);
router.post('/copy', validate(copyShiftsSchema), copyShifts);

// Literal paths come before /:shiftId so they aren't read as an id
router.get('/summary', validate({ query: shiftFilterQuerySchema }), getShiftsSummary);
router.get('/statement', statementLimiter, validate({ query: statementQuerySchema }), getStatement);
router.get('/schedule-message', validate({ query: scheduleMessageQuerySchema }), getScheduleMessage);
// Both of these plan routes between jobs, so they share the routing allowance
router.get('/conflicts', commuteLimiter, validate({ query: travelConflictsQuerySchema }), getConflicts);
router.get('/travel-conflicts', commuteLimiter, validate({ query: travelConflictsQuerySchema }), getTravelConflicts);
router.get('/', validate({ query: shiftFilterQuerySchema }), getMyShifts);

router.get('/:shiftId', validate({ params: shiftId }), getShiftById);
router.get('/:shiftId/leave-plan', commuteLimiter, validate({ params: shiftId, query: leavePlanQuerySchema }), getLeavePlan);
router.get('/:shiftId/weather', weatherLimiter, validate({ params: shiftId }), getShiftWeather);
router.get('/:shiftId/routes', commuteLimiter, validate({ params: shiftId, query: routesQuerySchema }), getShiftRoutes);
router.patch('/:shiftId', validate({ params: shiftId, body: updateShiftSchema }), updateShift);
router.delete('/:shiftId', validate({ params: shiftId }), deleteShift);
router.put('/:shiftId/missed', validate({ params: shiftId, body: markMissedSchema }), markMissed);
router.delete('/:shiftId/missed', validate({ params: shiftId }), clearMissed);

module.exports = router;
