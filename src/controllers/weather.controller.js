const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const weatherService = require('../services/weather.service');

const getShiftWeather = asyncHandler(async (req, res) => {
    const weather = await weatherService.getShiftWeather(req.user.id, req.validated.params.shiftId);
    res.status(200).json(new ApiResponse(200, weather, weather.status === 'ok' ? 'Weather ready' : 'No weather for this shift'));
});

module.exports = { getShiftWeather };
