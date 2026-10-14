const express = require('express');
const requireAuth = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const { inviteLimiter } = require('../middleware/rateLimiter');
const { idParams } = require('../validation/common.validation');
const { createShareSchema, sharedShiftsQuerySchema } = require('../validation/share.validation');
const { listOutgoing, createShare, revokeShare, listIncoming, getSharedShifts } = require('../controllers/share.controller');

const router = express.Router();

router.use(requireAuth);
router.get('/', listOutgoing); // people I share with
router.post('/', inviteLimiter, validate(createShareSchema), createShare);
router.get('/received', listIncoming); // people sharing with me — before /:shareId so it isn't read as an id
router.delete('/:shareId', validate({ params: idParams('shareId') }), revokeShare);
router.get('/:ownerId/shifts', validate({ params: idParams('ownerId'), query: sharedShiftsQuerySchema }), getSharedShifts);

module.exports = router;
