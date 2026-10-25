const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const env = require('../config/env');

const MINUTE_MS = 60 * 1000;

/**
 * Every limiter in the API is built here, so they answer in the same shape.
 * Signed-in routes count per user (people behind one Wi-Fi or one proxy don't
 * use up each other's allowance); public routes count per IP.
 */
const createLimiter = ({ windowMs, max, message }) =>
    rateLimit({
        windowMs,
        max: max * env.rateLimitScale,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip),
        message: { success: false, message },
    });

// Login/register/social-login ke liye — thoda generous (real users typos karte hain),
// par automated brute-force ke liye kaafi tight
const authLimiter = createLimiter({ windowMs: 15 * MINUTE_MS, max: 20, message: 'Too many attempts. Please try again in a few minutes.' });

// Anything that emails a 6-digit code (password reset, email verification)
const emailCodeLimiter = createLimiter({ windowMs: 15 * MINUTE_MS, max: 5, message: 'Too many attempts. Please try again in a few minutes.' });

// The app refreshes about once per access-token lifetime; this only stops a loop
const refreshLimiter = createLimiter({ windowMs: 15 * MINUTE_MS, max: 60, message: 'Too many requests. Please try again in a few minutes.' });

// Search runs as the user types (debounced in the app), so allow a few searches a
// second; the service caches repeats so the upstream services see far fewer.
const geocodeLimiter = createLimiter({ windowMs: MINUTE_MS, max: 90, message: 'Too many searches. Please wait a moment.' });

// Transitous and OSRM are volunteer-run — keep each user's routing requests modest
const transitLimiter = createLimiter({ windowMs: MINUTE_MS, max: 20, message: 'Too many route requests. Please wait a moment.' });
const commuteLimiter = createLimiter({ windowMs: MINUTE_MS, max: 30, message: 'Too many route requests. Please wait a moment.' });

// Forecasts are cached for half an hour per place, so this only stops a runaway client
const weatherLimiter = createLimiter({ windowMs: MINUTE_MS, max: 60, message: 'Too many weather requests. Please wait a moment.' });

// Inviting is the only write that touches other people's data
const inviteLimiter = createLimiter({ windowMs: 60 * MINUTE_MS, max: 30, message: 'Too many invites. Please try again later.' });

// Each scan is a paid Gemini call; nobody scans this many schedules by hand
const ocrLimiter = createLimiter({ windowMs: 60 * MINUTE_MS, max: 30, message: 'Too many scans. Please try again later.' });

// A full copy of the account is a big query; nobody needs it more than a few times an hour
const exportLimiter = createLimiter({ windowMs: 60 * MINUTE_MS, max: 10, message: 'Too many downloads. Please try again later.' });

module.exports = {
    authLimiter,
    emailCodeLimiter,
    refreshLimiter,
    geocodeLimiter,
    transitLimiter,
    commuteLimiter,
    weatherLimiter,
    inviteLimiter,
    ocrLimiter,
    exportLimiter,
};
