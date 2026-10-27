const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const assistantService = require('../services/assistant.service');

const sendMessage = asyncHandler(async (req, res) => {
    const turn = await assistantService.respond(req.user.id, req.body);
    res.status(200).json(new ApiResponse(200, turn, 'Assistant replied'));
});

const confirmProposal = asyncHandler(async (req, res) => {
    const saved = await assistantService.confirmProposal(req.user.id, req.body.proposal);
    res.status(200).json(new ApiResponse(200, saved, 'Saved'));
});

module.exports = { sendMessage, confirmProposal };
