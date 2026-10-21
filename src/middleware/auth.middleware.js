const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const prisma = require('../config/prisma');
const { verifyAccessToken } = require('../utils/token');

const BEARER_PREFIX = 'Bearer ';

const requireAuth = asyncHandler(async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith(BEARER_PREFIX)) {
        throw new ApiError(401, 'Not authenticated — no token provided');
    }

    let decoded;
    try {
        decoded = verifyAccessToken(authHeader.slice(BEARER_PREFIX.length).trim());
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            throw new ApiError(401, 'Access token expired');
        }
        throw new ApiError(401, 'Invalid access token');
    }

    // Looked up on every request so a deleted account — or one waiting to be
    // deleted — loses access at once, not when its token happens to expire.
    const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { id: true, email: true, name: true, avatarUrl: true, deletionRequestedAt: true },
    });

    if (!user || user.deletionRequestedAt) {
        throw new ApiError(401, 'User no longer exists');
    }
    delete user.deletionRequestedAt;

    req.user = user;
    req.sessionId = decoded.sid; // which device this is — "log out" ends only this one
    next();
});

module.exports = requireAuth;
