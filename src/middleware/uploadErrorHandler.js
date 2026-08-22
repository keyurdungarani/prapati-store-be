"use strict";

const multer = require("multer");
const { MAX_FILE_BYTES } = require("./upload");

// Turn multer failures into messages that say what went wrong.
//
// Without this, "your photo is 5MB" and "the database is down" both arrive as
// the same "Internal Server Error", and the user has no idea whether to pick a
// smaller file or call someone.
//
// Express 5 routes thrown errors from middleware here automatically.

const MB = (bytes) => (bytes / (1024 * 1024)).toFixed(0);

module.exports = function uploadErrorHandler(err, req, res, next) {
    if (!(err instanceof multer.MulterError)) return next(err);

    console.error("Upload error:", err.code, err.message);

    if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
            statusCode: 413,
            message: `Image is too large. Maximum size is ${MB(MAX_FILE_BYTES)}MB.`,
        });
    }

    if (err.code === "LIMIT_INVALID_MIME") {
        return res.status(415).json({
            statusCode: 415,
            message: "Unsupported image type. Use JPG, PNG, WEBP or GIF.",
        });
    }

    if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
        return res.status(400).json({
            statusCode: 400,
            message: "Upload one image in the 'image' field.",
        });
    }

    return res.status(400).json({
        statusCode: 400,
        message: "Image upload failed.",
    });
};
