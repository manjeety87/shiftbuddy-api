const crypto = require('crypto');

// The 6-digit codes we email (verify email, reset password). Stored hashed,
// short-lived, and only a few guesses allowed — a million possibilities is
// nothing to a script without those limits.

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;

/** "000000"–"999999", every value equally likely */
const generateCode = () => crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');

const hashCode = (code) => crypto.createHash('sha256').update(code).digest('hex');

const codeExpiry = () => new Date(Date.now() + CODE_TTL_MS);

/** Constant-time compare, so response timing doesn't leak how close a guess was. */
const codeMatches = (code, storedHash) => crypto.timingSafeEqual(Buffer.from(hashCode(code)), Buffer.from(storedHash));

module.exports = { MAX_CODE_ATTEMPTS, generateCode, hashCode, codeExpiry, codeMatches };
