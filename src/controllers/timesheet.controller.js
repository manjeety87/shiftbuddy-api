const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const timesheetService = require('../services/timesheet.service');

const getCurrent = asyncHandler(async (req, res) => {
    const entry = await timesheetService.getCurrentEntry(req.user.id);
    res.status(200).json(new ApiResponse(200, entry, entry ? 'Clocked in' : 'Not clocked in'));
});

const clockIn = asyncHandler(async (req, res) => {
    const entry = await timesheetService.clockIn(req.user.id, req.body);
    res.status(201).json(new ApiResponse(201, entry, 'Clocked in'));
});

const clockOut = asyncHandler(async (req, res) => {
    const entry = await timesheetService.clockOut(req.user.id);
    res.status(200).json(new ApiResponse(200, entry, 'Clocked out'));
});

const getTimesheet = asyncHandler(async (req, res) => {
    const timesheet = await timesheetService.getTimesheet(req.user.id, req.validated.query);
    res.status(200).json(new ApiResponse(200, timesheet, 'Timesheet fetched'));
});

const getWeekTimesheet = asyncHandler(async (req, res) => {
    const timesheet = await timesheetService.getWeekTimesheet(req.user.id, req.validated.query);
    res.status(200).json(new ApiResponse(200, timesheet, 'Week fetched'));
});

const getSummary = asyncHandler(async (req, res) => {
    const summary = await timesheetService.getSummary(req.user.id, req.validated.query);
    res.status(200).json(new ApiResponse(200, summary, 'Hours summary fetched'));
});

const createEntry = asyncHandler(async (req, res) => {
    const entry = await timesheetService.createEntry(req.user.id, req.body);
    res.status(201).json(new ApiResponse(201, entry, 'Time entry added'));
});

const getEntry = asyncHandler(async (req, res) => {
    const entry = await timesheetService.getEntry(req.user.id, req.validated.params.entryId);
    res.status(200).json(new ApiResponse(200, entry, 'Time entry fetched'));
});

const updateEntry = asyncHandler(async (req, res) => {
    const entry = await timesheetService.updateEntry(req.user.id, req.validated.params.entryId, req.body);
    res.status(200).json(new ApiResponse(200, entry, 'Time entry updated'));
});

const deleteEntry = asyncHandler(async (req, res) => {
    await timesheetService.deleteEntry(req.user.id, req.validated.params.entryId);
    res.status(200).json(new ApiResponse(200, null, 'Time entry deleted'));
});

const getUnlogged = asyncHandler(async (req, res) => {
    const unlogged = await timesheetService.getUnlogged(req.user.id);
    res.status(200).json(new ApiResponse(200, unlogged, 'Shifts waiting for hours'));
});

module.exports = { getUnlogged, getSummary, getWeekTimesheet, createEntry, getCurrent, clockIn, clockOut, getTimesheet, getEntry, updateEntry, deleteEntry };
