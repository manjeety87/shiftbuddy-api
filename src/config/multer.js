const multer = require('multer');
const ApiError = require('../utils/ApiError');

// Memory me store karte hain (disk pe nahi) — kyunki humein file sirf
// temporarily process karke Gemini ko bhejni hai, permanently save nahi karni
const storage = multer.memoryStorage();

const onlyTypes = (allowedTypes, message) => (req, file, cb) => {
    if (!allowedTypes.includes(file.mimetype)) {
        return cb(new ApiError(400, message));
    }
    cb(null, true);
};

/** A photo or screenshot of a schedule (scanning) */
const imageUpload = multer({
    storage,
    fileFilter: onlyTypes(['image/jpeg', 'image/png', 'image/webp'], 'Only JPEG, PNG, or WEBP images are allowed'),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
});

// Phones record AAC in an .m4a (MPEG-4) file; the names differ by platform and library
const AUDIO_TYPES = ['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/ogg'];

/** One spoken request to the assistant: a few seconds, so a small limit */
const audioUpload = multer({
    storage,
    fileFilter: onlyTypes(AUDIO_TYPES, 'Send the recording as M4A, AAC, MP3, WAV, WEBM or OGG audio'),
    limits: { fileSize: 3 * 1024 * 1024 }, // 3MB ≈ 1–2 minutes of speech, far more than one request
});

module.exports = { imageUpload, audioUpload };
