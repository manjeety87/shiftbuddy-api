const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const ocrService = require('../services/ocr.service');

const extractShifts = asyncHandler(async (req, res) => {
    if (!req.file) {
        throw new ApiError(400, 'No image uploaded — send it as "image" in form-data');
    }

    // On a team schedule this picks the right row; most people scan their own
    const employeeName = req.body.employeeName ?? req.user.name;

    const shifts = await ocrService.extractShiftsFromImage(req.user.id, req.file.buffer, { employeeName, timeZone: req.body.timeZone });

    res.status(200).json(
        new ApiResponse(200, { shifts }, 'Shifts extracted — please review before saving')
    );
});

module.exports = { extractShifts };
