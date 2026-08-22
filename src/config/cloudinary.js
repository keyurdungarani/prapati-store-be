"use strict";

const cloudinary = require("cloudinary").v2;
require("dotenv").config();

// Cloudinary image storage for product photos.
//
//   UPLOAD PATH (the file passes through this server, by design)
//     browser --multipart--> Express --upload_stream--> Cloudinary
//                               |                          |
//                        size + mime enforced        { secure_url,
//                        secret stays server-side      public_id }
//
//   Uploading straight from the browser would be faster, but then the server
//   would have to trust whatever URL the client reported back. Here the URL
//   can only come from an upload this server actually performed.
//
//   DELETION IS NOT ATOMIC WITH MONGO. There is no transaction spanning both
//   systems, so ordering is the whole strategy:
//
//     destroy BEFORE the db write succeeds -> a failed write leaves a product
//                                             pointing at a deleted image
//     destroy AFTER  the db write succeeds -> a failed destroy leaves an
//                                             orphaned file in Cloudinary
//
//   Always destroy AFTER. An orphan costs a little storage and is cleanable;
//   a live product with a dead image is broken in the user's face.

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const FOLDER = "prapatti-store/products";

/**
 * Upload an in-memory buffer. Resolves to { url, publicId } which is exactly
 * the shape Product.image stores.
 */
function uploadImage(buffer, { folder = FOLDER } = {}) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder, resource_type: "image" },
            (err, result) => {
                if (err) return reject(err);
                if (!result || !result.secure_url || !result.public_id) {
                    return reject(new Error("Cloudinary returned an unexpected response"));
                }
                resolve({ url: result.secure_url, publicId: result.public_id });
            }
        );
        stream.end(buffer);
    });
}

/**
 * Delete an asset. Never throws.
 *
 * Callers invoke this AFTER their database work has committed, so a failure
 * here must not turn a successful operation into an error for the user. It
 * logs and moves on; the leftover file is recoverable later.
 */
async function destroyImage(publicId) {
    if (!publicId) return { ok: false, skipped: true };
    try {
        await cloudinary.uploader.destroy(publicId);
        return { ok: true };
    } catch (err) {
        console.error(`Cloudinary destroy failed for ${publicId}:`, err);
        return { ok: false, error: err };
    }
}

module.exports = { cloudinary, uploadImage, destroyImage, FOLDER };
