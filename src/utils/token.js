const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

// Pinned so a token signed with any other algorithm is rejected outright
const ALGORITHM = 'HS256';

// Access token: short-lived (15 min), har request ke saath jaata hai.
// `sid` says which session it belongs to, so "log out" ends the right one.
const generateAccessToken = (user, sessionId) =>
    jwt.sign({ userId: user.id, email: user.email, sid: sessionId }, env.JWT_ACCESS_SECRET, { algorithm: ALGORITHM, expiresIn: env.JWT_ACCESS_EXPIRY });

// Refresh token: long-lived (30 din), sirf naya access token lene ke liye use hota hai.
// `jti` makes every token different, even two issued for one session in the same second.
const generateRefreshToken = (user, sessionId) =>
    jwt.sign({ userId: user.id, sid: sessionId, jti: crypto.randomUUID() }, env.JWT_REFRESH_SECRET, { algorithm: ALGORITHM, expiresIn: env.JWT_REFRESH_EXPIRY });

const verifyAccessToken = (token) => jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: [ALGORITHM] });

const verifyRefreshToken = (token) => jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: [ALGORITHM] });

// Restore token: proves "this person just signed in to an account waiting to be
// deleted", so the next call can bring it back. Its own key (derived, so no new
// setting), so it can never pass as an access or refresh token. `rqa` ties it to
// that one deletion request.
const RESTORE_EXPIRY = '15m';
const restoreSecret = () => crypto.createHmac('sha256', env.JWT_REFRESH_SECRET).update('account-restore').digest('hex');

const generateRestoreToken = (user) =>
    jwt.sign({ userId: user.id, rqa: user.deletionRequestedAt.getTime() }, restoreSecret(), { algorithm: ALGORITHM, expiresIn: RESTORE_EXPIRY });

const verifyRestoreToken = (token) => jwt.verify(token, restoreSecret(), { algorithms: [ALGORITHM] });

/** When a token we just signed stops working — read back from the token so the expiry setting lives in one place. */
const expiryOf = (token) => new Date(jwt.decode(token).exp * 1000);

// Tokens are long and already random, so a fast hash is the right tool
// (bcrypt is for passwords and ignores everything past 72 bytes).
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

module.exports = {
    generateAccessToken,
    generateRefreshToken,
    verifyAccessToken,
    verifyRefreshToken,
    generateRestoreToken,
    verifyRestoreToken,
    expiryOf,
    hashToken,
};
