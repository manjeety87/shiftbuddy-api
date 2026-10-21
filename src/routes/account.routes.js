const express = require('express');
const requireAuth = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const { authLimiter, exportLimiter } = require('../middleware/rateLimiter');
const { accountDeletionSchema, sessionParams } = require('../validation/account.validation');
const { listSessions, endSession, endOtherSessions, getSummary, exportAccount, requestDeletion } = require('../controllers/account.controller');

// The account as a whole: devices, a copy of the data, deletion. Restoring a
// deleted account signs in, so it lives with the other sign-ins (/auth/restore).
const router = express.Router();

router.use(requireAuth);
router.get('/sessions', listSessions);
router.delete('/sessions', endOtherSessions); // every device except this one
router.delete('/sessions/:sessionId', validate({ params: sessionParams }), endSession);
router.get('/summary', getSummary);
router.get('/export', exportLimiter, exportAccount);
// Checks a password, so it is rate limited like signing in
router.post('/deletion', authLimiter, validate(accountDeletionSchema), requestDeletion);

module.exports = router;
