const multer = require('multer');
const ApiError = require('../utils/ApiError');
const env = require('../config/env');

// Prisma messages are multi-line with code frames; the last line is the actual cause.
const lastLine = (text = '') => text.split(/\r?\n/).filter(Boolean).pop();

const DATABASE_DOWN_CODES = ['P1000', 'P1001', 'P1002', 'P1017'];

/**
 * Errors that aren't ours but have a known meaning → the ApiError to answer with.
 * Anything not listed here is a bug and becomes a generic 500.
 */
const toApiError = (err) => {
    if (err instanceof ApiError) return err;

    // express.json(): malformed or oversized body
    if (err.type === 'entity.parse.failed') return new ApiError(400, 'The request body isn’t valid JSON');
    if (err.type === 'entity.too.large') return new ApiError(413, 'That request is too large');

    if (err instanceof multer.MulterError) {
        return err.code === 'LIMIT_FILE_SIZE'
            ? new ApiError(413, 'That image is too large — the limit is 10 MB')
            : new ApiError(400, 'Send one image in the "image" field');
    }

    // Prisma: unique value taken (e.g. the same email registering twice at the same moment)
    if (err.code === 'P2002') return new ApiError(409, 'That already exists');
    // Prisma: the row was deleted between our check and the write
    if (err.code === 'P2025') return new ApiError(404, 'Not found');

    return null;
};

// Express recognises an error handler by its four parameters — `next` has to stay
const errorHandler = (err, req, res, next) => {
    const apiError = toApiError(err);
    if (apiError) {
        return res.status(apiError.statusCode).json({
            success: false,
            message: apiError.message,
            details: apiError.details,
        });
    }

    // Database unreachable (wrong/expired DATABASE_URL, DB down, network) —
    // a server problem, not the client's request. Don't leak Prisma internals.
    if (err.name === 'PrismaClientInitializationError' || DATABASE_DOWN_CODES.includes(err.errorCode || err.code)) {
        console.error('Database unavailable:', lastLine(err.message));
        return res.status(503).json({
            success: false,
            message: 'Database is unavailable right now. Please try again shortly.',
        });
    }

    console.error('Unhandled error:', err);

    return res.status(500).json({
        success: false,
        message: env.isDevelopment ? err.message : 'Internal server error',
    });
};

module.exports = errorHandler;
