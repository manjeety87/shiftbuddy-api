const express = require('express');
const ocrController = require('../controllers/ocr.controller');
const requireAuth = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const checkOcrUsageLimit = require('../middleware/checkOcrUsageLimit');
const { ocrLimiter } = require('../middleware/rateLimiter');
const { imageUpload } = require('../config/multer');
const { extractShiftsSchema } = require('../validation/ocr.validation');

const router = express.Router();

router.post(
    '/extract-shifts',
    requireAuth,
    ocrLimiter,
    checkOcrUsageLimit,
    imageUpload.single('image'),
    validate(extractShiftsSchema), // after multer: it's what fills req.body from the form fields
    ocrController.extractShifts
);

module.exports = router;
