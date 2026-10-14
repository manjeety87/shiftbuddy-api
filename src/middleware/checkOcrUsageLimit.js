const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { canUserUploadImage } = require('../services/usage.service');

const checkOcrUsageLimit = asyncHandler(async (req, res, next) => {
    const { allowed, reason } = await canUserUploadImage(req.user.id);

    if (!allowed) {
        throw new ApiError(403, reason || 'Upload limit reached for your plan');
    }

    next();
});

module.exports = checkOcrUsageLimit;