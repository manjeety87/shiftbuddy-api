const v = require('../../validation/auth.validation');
const u = require('../../validation/user.validation');
const { op, ok, ref, errors, error } = require('../helpers');

const tag = 'Auth & profile';
const authError = error(401, 'Wrong email/password, or the Google/Apple token didn’t verify');
const tooMany = errors.rateLimited;

module.exports = {
    '/auth/register': {
        post: op({
            tag, auth: false, body: v.registerSchema,
            summary: 'Create an account with email + password',
            description:
                'Password: 8+ characters, one uppercase letter, one number (stored with bcrypt). ' +
                'Sends a 6-digit email verification code. Returns the user and a token pair so the app is signed in at once. ' +
                'Rate limited with the other sign-in routes.',
            responses: { ...ok('Account created', ref('AuthResponse'), 201), ...errors.validation, ...error(409, 'An account with this email already exists'), ...tooMany },
        }),
    },
    '/auth/login': {
        post: op({
            tag, auth: false, body: v.loginSchema,
            summary: 'Sign in with email + password',
            description:
                'Returns the user and a fresh token pair. An unknown email answers 404 `NO_ACCOUNT` so the client can offer sign-up; a wrong password ' +
                '401 `WRONG_PASSWORD`; an account made with Google/Apple 401 `SOCIAL_ACCOUNT` (codes are in `details.code`).',
            responses: { ...ok('Signed in', ref('AuthResponse')), ...errors.validation, ...authError, ...error(404, 'No account uses this email (NO_ACCOUNT)'), ...tooMany },
        }),
    },
    '/auth/google': {
        post: op({
            tag, auth: false, body: v.googleAuthSchema,
            summary: 'Sign in (or sign up) with Google',
            description: 'Verifies the Google ID token server-side, then finds or creates the account (linking by email).',
            responses: { ...ok('Signed in', ref('AuthResponse')), ...errors.validation, ...authError, ...tooMany },
        }),
    },
    '/auth/apple': {
        post: op({
            tag, auth: false, body: v.appleAuthSchema,
            summary: 'Sign in (or sign up) with Apple',
            description: 'Verifies the Apple identity token. Apple only sends the user’s name the first time, so the app forwards `fullName` when it has it.',
            responses: { ...ok('Signed in', ref('AuthResponse')), ...errors.validation, ...authError, ...tooMany },
        }),
    },
    '/auth/refresh-token': {
        post: op({
            tag, auth: false, body: v.refreshTokenSchema,
            summary: 'Trade a refresh token for a new token pair',
            description:
                'Called by the app when an access token expires (one call at a time, then queued requests retry). ' +
                'The refresh token is rotated: the old one stops working, and using an old one again ends that session. ' +
                'Each device has its own session, so refreshing or signing out on one leaves the others alone.\n\n' +
                '**Browsers:** send the header `X-Auth-Transport: cookie` on sign-in and refresh. The refresh token then ' +
                'travels only as an httpOnly cookie (`sb_refresh`, path `/api/auth`) and is left out of response bodies; ' +
                'call this route with an empty body and `credentials: "include"`.',
            responses: { ...ok('New tokens', { type: 'object', properties: { accessToken: { type: 'string' }, refreshToken: { type: 'string' } } }), ...errors.validation, ...error(401, 'Refresh token invalid, expired or already used — sign in again') },
        }),
    },
    '/auth/me': {
        get: op({
            tag,
            summary: 'The signed-in user',
            description: 'Used on app start to restore the session and load settings (home, commute, arrival buffer).',
            responses: { ...ok('The user', ref('User')) },
        }),
    },
    '/auth/getCurrentUser': {
        get: op({
            tag,
            summary: 'The signed-in user (old name)',
            description: 'Same as `GET /auth/me`. Kept for app builds released before that route existed; new clients use `/auth/me`.',
            responses: { ...ok('The user', ref('User')) },
        }),
    },
    '/auth/logout': {
        post: op({
            tag,
            summary: 'Sign out',
            description: 'Ends this device’s session, so its refresh token stops working. Other devices stay signed in.',
            responses: { ...ok('Signed out') },
        }),
    },
    '/auth/account': {
        delete: op({
            tag,
            summary: 'Delete the account and everything in it',
            description: 'Permanent. Jobs, shifts and shares are removed with the user (database cascade).',
            responses: { ...ok('Account deleted') },
        }),
    },
    '/auth/profile': {
        patch: op({
            tag, body: u.updateProfileSchema,
            summary: 'Update name, tax estimate, commute mode or arrival buffer',
            description:
                'Send only what changes. `commuteMode` drives travel conflicts and leave-by times; ' +
                '`arrivalBufferMinutes` (0, 5, 10 or 15) is how early routes plan to get you to a shift.',
            responses: { ...ok('Updated user', ref('User')), ...errors.validation },
        }),
    },
    '/auth/home': {
        put: op({
            tag, body: u.homeLocationSchema,
            summary: 'Set the home address',
            description: 'Starting point for leave-by times and routes. Only ever visible to the user.',
            responses: { ...ok('Updated user', ref('User')), ...errors.validation },
        }),
        delete: op({
            tag,
            summary: 'Remove the home address',
            description: 'Routes then plan from the phone’s current location.',
            responses: { ...ok('Updated user', ref('User')) },
        }),
    },
    '/auth/verify-email/send': {
        post: op({
            tag,
            summary: 'Email a new 6-digit verification code',
            description: 'Code is stored hashed and expires in 10 minutes. Rate limited (5 per 15 min).',
            responses: { ...ok('Code sent'), ...tooMany },
        }),
    },
    '/auth/verify-email': {
        post: op({
            tag, body: u.verifyEmailSchema,
            summary: 'Verify the email with the 6-digit code',
            description:
                'Constant-time comparison, 5 attempts per code. Verifying also claims any pending share invites sent to this email.',
            responses: { ...ok('Verified user', ref('User')), ...errors.validation, ...error(400, 'Wrong or expired code'), ...tooMany },
        }),
    },
    '/auth/forgot-password': {
        post: op({
            tag, auth: false, body: v.forgotPasswordSchema,
            summary: 'Email a password reset code',
            description: 'Emails a 6-digit code. An unknown email answers 404 `NO_ACCOUNT`; an account made with Google/Apple (no password) 400 `SOCIAL_ACCOUNT`.',
            responses: { ...ok('Reset code sent'), ...errors.validation, ...error(400, 'The account has no password (SOCIAL_ACCOUNT)'), ...error(404, 'No account uses this email (NO_ACCOUNT)'), ...tooMany },
        }),
    },
    '/auth/reset-password': {
        post: op({
            tag, auth: false, body: v.resetPasswordSchema,
            summary: 'Set a new password with the emailed code',
            description: 'Same password rules as sign-up. A code allows 5 guesses and lasts 10 minutes. Signs out every device, and marks the email as verified (the code proved it).',
            responses: { ...ok('Password reset'), ...errors.validation, ...error(400, 'Wrong or expired code'), ...tooMany },
        }),
    },
    '/auth/change-password': {
        patch: op({
            tag, body: v.changePasswordSchema,
            summary: 'Change password (signed in)',
            description: 'Needs the current password. Every device is signed out, so the app asks to sign in again.',
            responses: { ...ok('Password changed'), ...errors.validation, ...error(400, 'Current password is wrong') },
        }),
    },
};
