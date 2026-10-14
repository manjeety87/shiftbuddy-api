const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const shiftService = require('../services/shift.service');
const travelConflictService = require('../services/travelConflict.service');
const conflictService = require('../services/conflict.service');
const scheduleMessageService = require('../services/scheduleMessage.service');

const createShift = asyncHandler(async (req, res) => {
    const shift = await shiftService.createShift(req.user.id, req.body);
    res.status(201).json(new ApiResponse(201, shift, 'Shift created successfully'));
});

const createShiftsBulk = asyncHandler(async (req, res) => {
    const result = await shiftService.createShiftsBulk(req.user.id, req.body.shifts);
    res.status(201).json(new ApiResponse(201, result, `${result.created.length} shift(s) created`));
});

const copyShifts = asyncHandler(async (req, res) => {
    const result = await shiftService.copyShifts(req.user.id, req.body);
    res.status(201).json(new ApiResponse(201, result, `${result.created.length} shift(s) copied`));
});

const getTravelConflicts = asyncHandler(async (req, res) => {
    const result = await travelConflictService.findTravelConflicts(req.user.id, req.validated.query);
    res.status(200).json(new ApiResponse(200, result, 'Travel conflicts checked'));
});

// Overlaps + travel-time conflicts together — what Home shows
const getConflicts = asyncHandler(async (req, res) => {
    const result = await conflictService.findConflicts(req.user.id, req.validated.query);
    res.status(200).json(new ApiResponse(200, result, 'Conflicts checked'));
});

const getScheduleMessage = asyncHandler(async (req, res) => {
    const result = await scheduleMessageService.getScheduleMessage(req.user.id, req.validated.query);
    res.status(200).json(new ApiResponse(200, result, 'Schedule message ready'));
});

const getShiftsSummary = asyncHandler(async (req, res) => {
    const summary = await shiftService.getShiftsSummary(req.user.id, req.validated.query);
    res.status(200).json(new ApiResponse(200, summary, 'Summary fetched successfully'));
});

const getMyShifts = asyncHandler(async (req, res) => {
    const shifts = await shiftService.getMyShifts(req.user.id, req.validated.query);
    res.status(200).json(new ApiResponse(200, shifts, 'Shifts fetched successfully'));
});

const getShiftById = asyncHandler(async (req, res) => {
    const shift = await shiftService.getShiftById(req.user.id, req.validated.params.shiftId);
    res.status(200).json(new ApiResponse(200, shift, 'Shift fetched successfully'));
});

const updateShift = asyncHandler(async (req, res) => {
    const shift = await shiftService.updateShift(req.user.id, req.validated.params.shiftId, req.body);
    res.status(200).json(new ApiResponse(200, shift, 'Shift updated successfully'));
});

const deleteShift = asyncHandler(async (req, res) => {
    await shiftService.deleteShift(req.user.id, req.validated.params.shiftId);
    res.status(200).json(new ApiResponse(200, null, 'Shift deleted successfully'));
});

module.exports = {
    createShift,
    createShiftsBulk,
    copyShifts,
    getTravelConflicts,
    getConflicts,
    getScheduleMessage,
    getShiftsSummary,
    getMyShifts,
    getShiftById,
    updateShift,
    deleteShift,
};
