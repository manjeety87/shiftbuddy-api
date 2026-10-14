const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const geocodeService = require('../services/geocode.service');

const search = asyncHandler(async (req, res) => {
    const { q, lat, lng } = req.validated.query;
    const near = lat !== undefined ? { lat, lng } : null;
    const places = await geocodeService.searchAddress(q, near);
    res.status(200).json(new ApiResponse(200, places, 'Places found'));
});

const reverse = asyncHandler(async (req, res) => {
    const { lat, lng } = req.validated.query;
    const place = await geocodeService.reverseGeocode(lat, lng);
    res.status(200).json(new ApiResponse(200, place, 'Address found'));
});

module.exports = { search, reverse };
