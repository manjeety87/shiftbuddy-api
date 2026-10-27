const express = require('express');
const requireAuth = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const { assistantLimiter } = require('../middleware/rateLimiter');
const { audioUpload } = require('../config/multer');
const { assistantMessageSchema, assistantVoiceSchema, confirmProposalSchema } = require('../validation/assistant.validation');
const { sendMessage, sendVoice, confirmProposal } = require('../controllers/assistant.controller');

const router = express.Router();

router.use(requireAuth);

router.post('/messages', assistantLimiter, validate(assistantMessageSchema), sendMessage);
// After multer: it is what fills req.body from the form fields
router.post('/voice', assistantLimiter, audioUpload.single('audio'), validate(assistantVoiceSchema), sendVoice);
router.post('/confirm', validate(confirmProposalSchema), confirmProposal);

module.exports = router;
