"use strict";

const multer = require("multer");

// Product image upload.
//
// memoryStorage, because the buffer goes straight to Cloudinary and is never
// written to this server's disk. The cap is what keeps that safe: the whole
// file sits in RAM for the duration of the request, so this number is also a
// per-upload memory budget. `files: 1` means one concurrent upload holds at
// most this much.
//
// The table never downloads the original anyway -- thumb() asks Cloudinary for
// a 96px variant -- so a large upload costs upload time, not page weight.

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15MB
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
