const crypto = require('crypto');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken, expiryOf, hashToken } = require('../utils/token');

// A session = one signed-in device or browser. Signing in starts one, every
// refresh swaps its refresh token for a new one (rotation), signing out ends it.
// All token issuing goes through here.

const USER_AGENT_MAX = 255;

const issueTokens = (user, sessionId) => {
    const refreshToken = generateRefreshToken(user, sessionId);
    return {
        accessToken: generateAccessToken(user, sessionId),
        refreshToken,
        stored: { refreshTokenHash: hashToken(refreshToken), expiresAt: expiryOf(refreshToken) },
    };
};

/** Signs `user` in on one more device. `context.userAgent` labels the device. */
const startSession = async (user, context = {}) => {
    const id = crypto.randomUUID();
    const { stored, ...tokens } = issueTokens(user, id);

    await prisma.$transaction([
        // Housekeeping while we're here: sessions nobody refreshed before they ran out
        prisma.session.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } }),
        prisma.session.create({ data: { id, userId: user.id, userAgent: context.userAgent?.slice(0, USER_AGENT_MAX), ...stored } }),
    ]);
    return tokens;
};

/**
 * Phones signed in before sessions existed hold a token with no session id,
 * checked against users.refreshToken. The first refresh moves them into a real
 * session, so nobody is signed out by the upgrade. Remove with that column.
 */
const adoptLegacyToken = async (decoded, refreshToken, context) => {
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user?.refreshToken || user.refreshToken !== hashToken(refreshToken)) {
        throw new ApiError(401, 'Session expired — please log in again');
    }
    await prisma.user.update({ where: { id: user.id }, data: { refreshToken: null } });
    return { user, ...(await startSession(user, context)) };
};

/** Trades a refresh token for a new pair. The old token stops working. */
const rotateSession = async (refreshToken, context = {}) => {
    let decoded;
    try {
        decoded = verifyRefreshToken(refreshToken);
    } catch {
        throw new ApiError(401, 'Invalid or expired refresh token');
    }
    if (!decoded.sid) return adoptLegacyToken(decoded, refreshToken, context);

    const session = await prisma.session.findUnique({ where: { id: decoded.sid }, include: { user: true } });
    if (!session || session.userId !== decoded.userId) {
        throw new ApiError(401, 'Session expired — please log in again');
    }

    const presentedHash = hashToken(refreshToken);
    if (session.refreshTokenHash !== presentedHash) {
        // A token that was already swapped is being used again — it may have been
        // copied. End this session; the real owner signs in again, the copy is dead.
        await prisma.session.deleteMany({ where: { id: session.id } });
        throw new ApiError(401, 'Session invalid — please log in again');
    }

    const { stored, ...tokens } = issueTokens(session.user, session.id);
    // Only swap if the stored token is still the one presented: two refreshes
    // racing with the same token can't both win.
    const { count } = await prisma.session.updateMany({
        where: { id: session.id, refreshTokenHash: presentedHash },
        data: { ...stored, lastUsedAt: new Date() },
    });
    if (count === 0) throw new ApiError(401, 'Session invalid — please log in again');

    return { user: session.user, ...tokens };
};

/** Sign out of one place. Tokens from before sessions existed carry no id: clear the old single token instead. */
const endSession = async (userId, sessionId) => {
    if (sessionId) {
        await prisma.session.deleteMany({ where: { id: sessionId, userId } });
    } else {
        await prisma.user.update({ where: { id: userId }, data: { refreshToken: null } });
    }
};

/** Sign out everywhere — after a password change or reset. Returns the query so callers can put it in a transaction. */
const endAllSessionsQuery = (userId) => prisma.session.deleteMany({ where: { userId } });

module.exports = { startSession, rotateSession, endSession, endAllSessionsQuery };
