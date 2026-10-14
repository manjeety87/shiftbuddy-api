const express = require('express');
const requireAuth = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const { transitLimiter } = require('../middleware/rateLimiter');
const { plan } = require('../controllers/transit.controller');
const { planQuerySchema } = require('../validation/transit.validation');

const router = express.Router();

router.use(requireAuth, transitLimiter);
router.get('/plan', validate({ query: planQuerySchema }), plan);

module.exports = router;
