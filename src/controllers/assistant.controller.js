const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const assistantService = require('../services/assistant.service');

const sendMessage = asyncHandler(async (req, res) => {
    const turn = await assistantService.respond(req.user.id, req.body);
    res.status(200).json(new ApiResponse(200, turn, 'Assistant replied'));
});

const sendVoice = asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, 'No recording — send it as "audio" in form-data');
    const turn = await assistantService.respondToVoice(req.user.id, { ...req.body, audio: req.file.buffer, mimeType: req.file.mimetype });
    res.status(200).json(new ApiResponse(200, turn, turn.heard ? 'Assistant replied' : 'Nothing was heard'));
});

const confirmProposal = asyncHandler(async (req, res) => {
    const saved = await assistantService.confirmProposal(req.user.id, req.body.proposal);
    res.status(200).json(new ApiResponse(200, saved, 'Saved'));
});

module.exports = { sendMessage, sendVoice, confirmProposal };
