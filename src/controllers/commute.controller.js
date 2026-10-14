const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const commuteService = require('../services/commute.service');

const getLeavePlan = asyncHandler(async (req, res) => {
    const plan = await commuteService.getLeavePlan(req.user.id, req.validated.params.shiftId);
    res.status(200).json(new ApiResponse(200, plan, plan ? 'Leave plan ready' : 'No leave plan for this shift'));
});

const getShiftRoutes = asyncHandler(async (req, res) => {
    const { fromLat, fromLng } = req.validated.query;
    const origin = fromLat !== undefined ? { lat: fromLat, lng: fromLng } : null;

    const routes = await commuteService.getShiftRoutes(req.user.id, req.validated.params.shiftId, origin);
    res.status(200).json(new ApiResponse(200, routes, 'Routes found'));
});

module.exports = { getLeavePlan, getShiftRoutes };
