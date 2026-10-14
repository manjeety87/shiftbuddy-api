const env = require('../config/env');
const { expiryOf } = require('./token');

// Where the refresh token lives for browsers. A web page can't keep a secret:
// anything in localStorage can be read by any script on the page. An httpOnly
// cookie can't be read by scripts at all — the browser just sends it back to us.
//
// The mobile app keeps getting the token in the response body (it stores it in
// the phone's secure storage). A browser client opts in by sending the header
//   X-Auth-Transport: cookie
// A custom header also can't be sent by another website without a CORS
// preflight, which only our allowed origins pass — that's the CSRF protection.

const COOKIE_NAME = 'sb_refresh';
const TRANSPORT_HEADER = 'x-auth-transport';

const baseOptions = () => ({
    httpOnly: true,
    secure: env.isProduction || env.COOKIE_SAMESITE === 'none', // browsers insist on Secure for SameSite=None
    sameSite: env.COOKIE_SAMESITE,
    path: '/api/auth', // only sent to the auth routes, never with ordinary API calls
});

const usesCookie = (req) => req.get(TRANSPORT_HEADER) === 'cookie';

const setRefreshCookie = (res, refreshToken) => res.cookie(COOKIE_NAME, refreshToken, { ...baseOptions(), expires: expiryOf(refreshToken) });

const clearRefreshCookie = (res) => res.clearCookie(COOKIE_NAME, baseOptions());

const readRefreshCookie = (req) => (usesCookie(req) ? req.cookies?.[COOKIE_NAME] : undefined);

module.exports = { usesCookie, setRefreshCookie, clearRefreshCookie, readRefreshCookie };
