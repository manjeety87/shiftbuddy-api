const express = require('express');
const authController = require('../controllers/auth.controller');
const validate = require('../middleware/validate.middleware');
const requireAuth = require('../middleware/auth.middleware');
const { authLimiter, emailCodeLimiter, refreshLimiter } = require('../middleware/rateLimiter');
const { registerSchema, loginSchema, refreshTokenSchema, googleAuthSchema, resetPasswordSchema, forgotPasswordSchema, appleAuthSchema, changePasswordSchema } = require('../validation/auth.validation');
const { updateProfileSchema, homeLocationSchema, verifyEmailSchema } = require('../validation/user.validation');

const router = express.Router();
const { login, register, getCurrentLoggedInUser, refreshAccessToken, logout, deleteAccount, googleLogin, appleLogin, updateProfile, sendEmailVerification, verifyEmail, setHomeLocation, removeHomeLocation, forgotPassword, resetPassword, changePassword } = authController;

// Signing in
router.post('/register', authLimiter, validate(registerSchema), register);
router.post('/login', authLimiter, validate(loginSchema), login);
router.post('/google', authLimiter, validate(googleAuthSchema), googleLogin);
router.post('/apple', authLimiter, validate(appleAuthSchema), appleLogin);
router.post('/refresh-token', refreshLimiter, validate(refreshTokenSchema), refreshAccessToken);
router.post('/forgot-password', emailCodeLimiter, validate(forgotPasswordSchema), forgotPassword);
router.post('/reset-password', emailCodeLimiter, validate(resetPasswordSchema), resetPassword);

// The signed-in user
router.get('/me', requireAuth, getCurrentLoggedInUser);
router.get('/getCurrentUser', requireAuth, getCurrentLoggedInUser); // older app builds call this name
router.post('/logout', requireAuth, logout);
router.delete('/account', requireAuth, deleteAccount);
router.patch('/profile', requireAuth, validate(updateProfileSchema), updateProfile);
router.patch('/change-password', requireAuth, validate(changePasswordSchema), changePassword);
router.put('/home', requireAuth, validate(homeLocationSchema), setHomeLocation);
router.delete('/home', requireAuth, removeHomeLocation);
router.post('/verify-email/send', requireAuth, emailCodeLimiter, sendEmailVerification);
router.post('/verify-email', requireAuth, authLimiter, validate(verifyEmailSchema), verifyEmail);

module.exports = router;
