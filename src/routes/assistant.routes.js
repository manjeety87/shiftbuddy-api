const express = require('express');
const requireAuth = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const { assistantLimiter } = require('../middleware/rateLimiter');
const { audioUpload } = require('../config/multer');
const { assistantMessageSchema, assistantVoiceSchema, confirmProposalSchema } = require('../validation/assistant.validation');
const { sendMessage, sendVoice, transcribeVoice, confirmProposal } = require('../controllers/assistant.controller');

const router = express.Router();

router.use(requireAuth);

router.post('/messages', assistantLimiter, validate(assistantMessageSchema), sendMessage);
// After multer: it is what fills req.body from the form fields
router.post('/voice', assistantLimiter, audioUpload.single('audio'), validate(assistantVoiceSchema), sendVoice);
// Words only: the web app shows them, then sends them to /messages — two short requests, not one long one
router.post('/transcribe', assistantLimiter, audioUpload.single('audio'), transcribeVoice);
router.post('/confirm', validate(confirmProposalSchema), confirmProposal);

module.exports = router;
