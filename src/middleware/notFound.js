const ApiError = require('../utils/ApiError');

// Without this Express answers unknown URLs with an HTML page, which a client
// expecting JSON can't read.
const notFound = (req, res, next) => next(new ApiError(404, 'Route not found'));

module.exports = notFound;
