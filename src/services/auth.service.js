const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const appleSignin = require('apple-signin-auth');
const prisma = require('../config/prisma');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const { MAX_CODE_ATTEMPTS, generateCode, hashCode, codeExpiry, codeMatches } = require('../utils/oneTimeCode');
const { sendPasswordResetEmail, sendVerificationEmail } = require('./email.service');
const { startSession, rotateSession, endSession, endAllSessionsQuery } = require('./session.service');

// Accounts: signing up and in (password, Google, Apple), the profile, email
// verification and password recovery. Tokens and sessions are session.service's job.
//
// `context` on the sign-in functions is `{ userAgent }` — which device this is.

const SALT_ROUNDS = 10;
const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

// Client ko jo data bhejna hai — password/tokens kabhi include nahi hote
const toPublicUser = (user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    isEmailVerified: user.isEmailVerified,
    hasPassword: !!user.password,
    signInMethods: { google: !!user.googleId, apple: !!user.appleId },
    taxDeductionPercent: user.taxDeductionPercent,
    commuteMode: user.commuteMode,
    arrivalBufferMinutes: user.arrivalBufferMinutes,
    homeLocation:
        user.homeLatitude != null && user.homeLongitude != null
            ? { address: user.homeAddress, latitude: user.homeLatitude, longitude: user.homeLongitude }
            : null,
});

const signIn = async (user, context) => ({ user: toPublicUser(user), ...(await startSession(user, context)) });

const findUserOrThrow = async (userId) => {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new ApiError(401, 'User no longer exists');
    return user;
};

const registerUser = async ({ name, email, password }, context) => {
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
        throw new ApiError(409, 'An account with this email already exists');
    }

    const user = await prisma.user.create({
        data: { name, email, password: await bcrypt.hash(password, SALT_ROUNDS) },
    });

    // First verification code goes out right away; a failed email must not fail sign-up
    // (the app offers "Resend code").
    sendEmailVerification(user.id).catch((err) => console.error('Verification email not sent:', err.message));

    return signIn(user, context);
};

const noAccount = () => new ApiError(404, 'No account uses this email', { code: 'NO_ACCOUNT' });

const loginUser = async ({ email, password }, context) => {
    const user = await prisma.user.findUnique({ where: { email } });

    // The app tells an unknown email apart from a wrong password so it can offer sign-up
    // (the user's call, 2026-10-09). Sign-up already answers 409 for a taken email, so this
    // gives away nothing new; authLimiter is what slows guessing down.
    if (!user) throw noAccount();
    if (!user.password) throw new ApiError(401, 'This account signs in with Google or Apple — use that button', { code: 'SOCIAL_ACCOUNT' });
    if (!(await bcrypt.compare(password, user.password))) throw new ApiError(401, 'Incorrect password', { code: 'WRONG_PASSWORD' });

    return signIn(user, context);
};

/**
 * Google and Apple have already proved the person owns `email`. Finds their
 * account or creates it, and links the provider id on first use.
 *
 * If an account with that email exists but was never verified, whoever made it
 * didn't prove they own the address — it could be someone squatting on it. The
 * real owner takes it over: the old password and sessions stop working.
 */
const signInWithProvider = async ({ email, providerField, providerId, name, avatarUrl }, context) => {
    const existing = await prisma.user.findUnique({ where: { email } });

    if (!existing) {
        const user = await prisma.user.create({
            data: { email, name: name || email.split('@')[0], avatarUrl, isEmailVerified: true, [providerField]: providerId },
        });
        return signIn(user, context);
    }

    if (existing[providerField] && existing.isEmailVerified) return signIn(existing, context);

    // Already linked to this provider = already theirs; only an unlinked, unverified account is taken over
    const takeover = !existing.isEmailVerified && !existing[providerField];
    const [user] = await prisma.$transaction([
        prisma.user.update({
            where: { id: existing.id },
            data: {
                [providerField]: existing[providerField] ?? providerId,
                avatarUrl: existing.avatarUrl ?? avatarUrl,
                isEmailVerified: true,
                ...(takeover && { password: null, refreshToken: null }),
            },
        }),
        ...(takeover ? [endAllSessionsQuery(existing.id)] : []),
    ]);
    return signIn(user, context);
};

const googleAuth = async ({ idToken }, context) => {
    let payload;
    try {
        const ticket = await googleClient.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID });
        payload = ticket.getPayload();
    } catch {
        throw new ApiError(401, 'Invalid Google token');
    }

    if (!payload?.email || payload.email_verified === false) {
        throw new ApiError(401, 'Your Google account doesn’t have a verified email');
    }

    return signInWithProvider(
        { email: payload.email.toLowerCase(), providerField: 'googleId', providerId: payload.sub, name: payload.name, avatarUrl: payload.picture },
        context
    );
};

const appleAuth = async ({ identityToken, fullName }, context) => {
    let payload;
    try {
        payload = await appleSignin.verifyIdToken(identityToken, { audience: env.APPLE_BUNDLE_ID });
    } catch {
        throw new ApiError(401, 'Invalid Apple token');
    }

    // Apple ka email kabhi kabhi private-relay wala hota hai
    // (jaise xyz@privaterelay.appleid.com) — wo bhi bilkul valid hai, use karo
    if (!payload.email) {
        throw new ApiError(401, 'Apple account has no email');
    }

    // 'fullName' sirf PEHLI baar client se aata hai (Apple ka rule)
    return signInWithProvider(
        { email: payload.email.toLowerCase(), providerField: 'appleId', providerId: payload.sub, name: fullName },
        context
    );
};

const refreshAccessToken = async ({ refreshToken }, context) => {
    const { user, ...tokens } = await rotateSession(refreshToken, context);
    return { user: toPublicUser(user), ...tokens };
};

const logoutUser = (userId, sessionId) => endSession(userId, sessionId);

const deleteAccount = async (userId) => {
    // Jobs, shifts, sessions and shares all cascade from the user row
    await prisma.user.delete({ where: { id: userId } });
};

const updateProfile = async (userId, data) => toPublicUser(await prisma.user.update({ where: { id: userId }, data }));

const getPublicUser = async (userId) => toPublicUser(await findUserOrThrow(userId));

const sendEmailVerification = async (userId) => {
    const user = await findUserOrThrow(userId);
    if (user.isEmailVerified) throw new ApiError(400, 'Your email is already verified');

    const code = generateCode();
    await prisma.user.update({
        where: { id: userId },
        data: { emailVerificationCode: hashCode(code), emailVerificationExpiry: codeExpiry(), emailVerificationAttempts: 0 },
    });

    try {
        await sendVerificationEmail(user.email, code);
    } catch (err) {
        console.error('Verification email failed:', err.message);
        throw new ApiError(503, 'We couldn’t send the email right now. Please try again shortly.');
    }
};

const verifyEmail = async (userId, { code }) => {
    const user = await findUserOrThrow(userId);
    if (user.isEmailVerified) return toPublicUser(user);

    if (!user.emailVerificationCode || !user.emailVerificationExpiry || user.emailVerificationExpiry < new Date()) {
        throw new ApiError(400, 'This code has expired — tap “Resend code” for a new one');
    }
    if (user.emailVerificationAttempts >= MAX_CODE_ATTEMPTS) {
        throw new ApiError(429, 'Too many wrong codes — tap “Resend code” for a new one');
    }

    if (!codeMatches(code, user.emailVerificationCode)) {
        const attempts = user.emailVerificationAttempts + 1;
        await prisma.user.update({ where: { id: userId }, data: { emailVerificationAttempts: attempts } });
        const left = MAX_CODE_ATTEMPTS - attempts;
        throw new ApiError(400, left > 0
            ? `That code isn’t right — ${left} ${left === 1 ? 'try' : 'tries'} left.`
            : 'Too many wrong codes — tap “Resend code” for a new one');
    }

    const verified = await prisma.user.update({
        where: { id: userId },
        data: { isEmailVerified: true, emailVerificationCode: null, emailVerificationExpiry: null, emailVerificationAttempts: 0 },
    });
    return toPublicUser(verified);
};

const setHomeLocation = async (userId, { address, latitude, longitude }) =>
    toPublicUser(await prisma.user.update({
        where: { id: userId },
        data: { homeAddress: address, homeLatitude: latitude, homeLongitude: longitude },
    }));

const removeHomeLocation = async (userId) =>
    toPublicUser(await prisma.user.update({
        where: { id: userId },
        data: { homeAddress: null, homeLatitude: null, homeLongitude: null },
    }));

/** A new password signs the account out everywhere: whoever knew the old one loses access. */
const setPasswordAndSignOutEverywhere = async (userId, newPassword, extraData = {}) => {
    const password = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await prisma.$transaction([
        prisma.user.update({ where: { id: userId }, data: { password, refreshToken: null, ...extraData } }),
        endAllSessionsQuery(userId),
    ]);
};

const changePassword = async (userId, { currentPassword, newPassword }) => {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user || !user.password) {
        throw new ApiError(400, 'This account signed in with Google or Apple and has no password to change');
    }
    if (!(await bcrypt.compare(currentPassword, user.password))) {
        throw new ApiError(401, 'Current password is incorrect');
    }

    await setPasswordAndSignOutEverywhere(userId, newPassword);
};

const forgotPassword = async ({ email }) => {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) throw noAccount();
    if (!user.password) throw new ApiError(400, 'This account signs in with Google or Apple, so it has no password to reset', { code: 'SOCIAL_ACCOUNT' });

    const code = generateCode();
    await prisma.user.update({
        where: { id: user.id },
        data: { resetPasswordCode: hashCode(code), resetPasswordExpiry: codeExpiry(), resetPasswordAttempts: 0 },
    });

    await sendPasswordResetEmail(user.email, code);
};

const resetPassword = async ({ email, code, newPassword }) => {
    const user = await prisma.user.findUnique({ where: { email } });
    // One message for every failure, so this can't be used to learn which emails have accounts
    const invalid = () => new ApiError(400, 'Invalid or expired reset code — request a new one');

    if (!user?.resetPasswordCode || !user.resetPasswordExpiry || user.resetPasswordExpiry < new Date()) throw invalid();
    if (user.resetPasswordAttempts >= MAX_CODE_ATTEMPTS) throw invalid();

    if (!codeMatches(code, user.resetPasswordCode)) {
        await prisma.user.update({ where: { id: user.id }, data: { resetPasswordAttempts: { increment: 1 } } });
        throw invalid();
    }

    // Getting the code by email also proves the address is theirs
    await setPasswordAndSignOutEverywhere(user.id, newPassword, {
        resetPasswordCode: null,
        resetPasswordExpiry: null,
        resetPasswordAttempts: 0,
        isEmailVerified: true,
    });
};

module.exports = {
    registerUser,
    loginUser,
    googleAuth,
    appleAuth,
    refreshAccessToken,
    logoutUser,
    deleteAccount,
    updateProfile,
    getPublicUser,
    sendEmailVerification,
    verifyEmail,
    setHomeLocation,
    removeHomeLocation,
    changePassword,
    forgotPassword,
    resetPassword,
};
