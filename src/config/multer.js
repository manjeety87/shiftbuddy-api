const multer = require('multer');
const ApiError = require('../utils/ApiError');

// Memory me store karte hain (disk pe nahi) — kyunki humein image sirf
// temporarily process karke Gemini ko bhejni hai, permanently save nahi karni
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.mimetype)) {
        return cb(new ApiError(400, 'Only JPEG, PNG, or WEBP images are allowed'));
    }
    cb(null, true);
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
});

module.exports = upload;