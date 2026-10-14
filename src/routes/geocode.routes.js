const express = require('express');
const requireAuth = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const { geocodeLimiter } = require('../middleware/rateLimiter');
const { search, reverse } = require('../controllers/geocode.controller');
const { searchQuerySchema, reverseQuerySchema } = require('../validation/geocode.validation');

const router = express.Router();

router.use(requireAuth, geocodeLimiter);
router.get('/search', validate({ query: searchQuerySchema }), search);
router.get('/reverse', validate({ query: reverseQuerySchema }), reverse);

module.exports = router;
