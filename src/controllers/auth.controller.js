const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const authService = require('../services/auth.service');
const { usesCookie, setRefreshCookie, clearRefreshCookie, readRefreshCookie } = require('../utils/refreshCookie');

// Which device is signing in — stored on the session
const contextOf = (req) => ({ userAgent: req.get('user-agent') });

/**
 * Answers a sign-in or refresh with `{ user, accessToken, refreshToken }`.
 * Browsers (see refreshCookie.js) get the refresh token as an httpOnly cookie
 * instead of in the body.
 */
const sendSession = (req, res, status, { refreshToken, ...result }, message) => {
    if (usesCookie(req)) {
        setRefreshCookie(res, refreshToken);
        return res.status(status).json(new ApiResponse(status, result, message));
    }
    return res.status(status).json(new ApiResponse(status, { ...result, refreshToken }, message));
};

const register = asyncHandler(async (req, res) => {
    const result = await authService.registerUser(req.body, contextOf(req));
    sendSession(req, res, 201, result, 'Account created successfully');
});

const login = asyncHandler(async (req, res) => {
    const result = await authService.loginUser(req.body, contextOf(req));
    sendSession(req, res, 200, result, 'Logged in successfully');
});

const googleLogin = asyncHandler(async (req, res) => {
    const result = await authService.googleAuth(req.body, contextOf(req));
    sendSession(req, res, 200, result, 'Logged in with Google successfully');
});

const appleLogin = asyncHandler(async (req, res) => {
    const result = await authService.appleAuth(req.body, contextOf(req));
    sendSession(req, res, 200, result, 'Logged in with Apple successfully');
});

const refreshAccessToken = asyncHandler(async (req, res) => {
    const refreshToken = req.body.refreshToken ?? readRefreshCookie(req);
    if (!refreshToken) throw new ApiError(401, 'Session expired — please log in again');

    const result = await authService.refreshAccessToken({ refreshToken }, contextOf(req));
    sendSession(req, res, 200, result, 'Token refreshed successfully');
});

const getCurrentLoggedInUser = asyncHandler(async (req, res) => {
    // Middleware sirf auth ke liye minimal fields laata hai — app ko poora public user chahiye
    // (hasPassword, taxDeductionPercent, homeLocation), warna app reload pe ye gayab ho jaate hain
    const user = await authService.getPublicUser(req.user.id);
    res.status(200).json(new ApiResponse(200, user, 'Current user fetched'));
});

const logout = asyncHandler(async (req, res) => {
    await authService.logoutUser(req.user.id, req.sessionId);
    clearRefreshCookie(res);
    res.status(200).json(new ApiResponse(200, null, 'Logged out successfully'));
});

const restoreAccount = asyncHandler(async (req, res) => {
    const result = await authService.restoreAccount(req.body, contextOf(req));
    sendSession(req, res, 200, result, 'Welcome back — your account is restored');
});

const updateProfile = asyncHandler(async (req, res) => {
    const updatedUser = await authService.updateProfile(req.user.id, req.body);
    res.status(200).json(new ApiResponse(200, updatedUser, 'Profile updated successfully'));
});

const sendEmailVerification = asyncHandler(async (req, res) => {
    await authService.sendEmailVerification(req.user.id);
    res.status(200).json(new ApiResponse(200, null, 'Verification code sent'));
});

const verifyEmail = asyncHandler(async (req, res) => {
    const user = await authService.verifyEmail(req.user.id, req.body);
    res.status(200).json(new ApiResponse(200, user, 'Email verified'));
});

const setHomeLocation = asyncHandler(async (req, res) => {
    const user = await authService.setHomeLocation(req.user.id, req.body);
    res.status(200).json(new ApiResponse(200, user, 'Home address saved'));
});

const removeHomeLocation = asyncHandler(async (req, res) => {
    const user = await authService.removeHomeLocation(req.user.id);
    res.status(200).json(new ApiResponse(200, user, 'Home address removed'));
});

const forgotPassword = asyncHandler(async (req, res) => {
    await authService.forgotPassword(req.body);
    res.status(200).json(new ApiResponse(200, null, 'Reset code sent'));
});

const changePassword = asyncHandler(async (req, res) => {
    await authService.changePassword(req.user.id, req.body);
    clearRefreshCookie(res);
    res.status(200).json(new ApiResponse(200, null, 'Password changed successfully'));
});

const resetPassword = asyncHandler(async (req, res) => {
    await authService.resetPassword(req.body);
    res.status(200).json(new ApiResponse(200, null, 'Password reset successfully'));
});

module.exports = {
    register,
    login,
    googleLogin,
    appleLogin,
    refreshAccessToken,
    getCurrentLoggedInUser,
    logout,
    restoreAccount,
    updateProfile,
    sendEmailVerification,
    verifyEmail,
    setHomeLocation,
    removeHomeLocation,
    forgotPassword,
    changePassword,
    resetPassword,
};
