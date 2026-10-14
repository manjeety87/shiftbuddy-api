const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const shareService = require('../services/share.service');

const listOutgoing = asyncHandler(async (req, res) => {
    const shares = await shareService.listOutgoing(req.user.id);
    res.status(200).json(new ApiResponse(200, shares, 'Shares fetched'));
});

const createShare = asyncHandler(async (req, res) => {
    const share = await shareService.createShare(req.user.id, req.body);
    res.status(201).json(new ApiResponse(201, share, 'Shifts shared'));
});

const revokeShare = asyncHandler(async (req, res) => {
    await shareService.revokeShare(req.user.id, req.validated.params.shareId);
    res.status(200).json(new ApiResponse(200, null, 'Sharing stopped'));
});

const listIncoming = asyncHandler(async (req, res) => {
    const shares = await shareService.listIncoming(req.user.id);
    res.status(200).json(new ApiResponse(200, shares, 'Shared schedules fetched'));
});

const getSharedShifts = asyncHandler(async (req, res) => {
    const { params, query } = req.validated;
    const schedule = await shareService.getSharedShifts(req.user.id, params.ownerId, query);
    res.status(200).json(new ApiResponse(200, schedule, 'Shared shifts fetched'));
});

module.exports = { listOutgoing, createShare, revokeShare, listIncoming, getSharedShifts };
