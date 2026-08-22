"use strict";

const multer = require("multer");

// Product image upload.
//
// memoryStorage, because the buffer goes straight to Cloudinary and is never
// written to this server's disk. The 2MB cap is what keeps that safe: without
// it, a large upload would be buffered in RAM in full.

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB
const ALLOWED_MIME = /^image\/(jpe?g|png|webp|gif)$/;

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_FILE_BYTES,
        files: 1,
    },
    fileFilter: (req, file, cb) => {
        if (ALLOWED_MIME.test(file.mimetype)) return cb(null, true);
        // Flagged rather than thrown, so uploadErrorHandler can turn it into a
        // 415 with a message naming the accepted types.
        const err = new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname);
        err.code = "LIMIT_INVALID_MIME";
        cb(err);
    },
});

/** Accepts a single `image` field. */
const uploadProductImage = upload.single("image");

module.exports = {
    upload,
    uploadProductImage,
    MAX_FILE_BYTES,
    ALLOWED_MIME,
};
