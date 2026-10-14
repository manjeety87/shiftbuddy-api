const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const transitService = require('../services/transit.service');

const plan = asyncHandler(async (req, res) => {
    const { fromLat, fromLng, toLat, toLng, time, timeType } = req.validated.query;

    const result = await transitService.planTrip({
        from: { lat: fromLat, lng: fromLng },
        to: { lat: toLat, lng: toLng },
        time,
        timeType,
    });
    res.status(200).json(new ApiResponse(200, result, 'Transit options found'));
});

module.exports = { plan };
