const express = require('express');
const requireAuth = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const { assistantLimiter } = require('../middleware/rateLimiter');
const { assistantMessageSchema, confirmProposalSchema } = require('../validation/assistant.validation');
const { sendMessage, confirmProposal } = require('../controllers/assistant.controller');

const router = express.Router();

router.use(requireAuth);

router.post('/messages', assistantLimiter, validate(assistantMessageSchema), sendMessage);
router.post('/confirm', validate(confirmProposalSchema), confirmProposal);

module.exports = router;
