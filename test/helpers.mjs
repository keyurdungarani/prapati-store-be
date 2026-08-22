import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { inject, vi } from "vitest";
import { createRequire } from "module";

// Image store stubbing.
//
// vi.mock() does NOT reach the controller here: app.js and everything under it
// are CommonJS, so the controller's require("../../config/cloudinary") resolves
// through Node's CJS cache, while vi.mock only rewires vitest's ESM graph. A
// mock declared with vi.mock is a DIFFERENT object from the one the controller
// calls, so the real Cloudinary SDK still runs -- verified: tests were making
// live upload requests.
//
// createRequire gives us the exact CJS module instance the controller holds, so
// replacing methods on it actually takes effect. The controller calls through
// the module object (imageStore.uploadImage) rather than destructuring, which
// is what makes the swap visible.

const require = createRequire(import.meta.url);

export const UPLOADED = Object.freeze({
    url: "https://res.cloudinary.com/demo/image/upload/v1/test/pic.jpg",
    publicId: "test/pic",
});

/**
 * Replace uploadImage/destroyImage with spies for the duration of a test.
 * Returns the spies so assertions can check call counts and arguments.
 */
export function stubImageStore() {
    const imageStore = require("../src/config/cloudinary.js");
    const uploadImage = vi.fn(async () => ({ ...UPLOADED }));
    const destroyImage = vi.fn(async () => ({ ok: true }));
    imageStore.uploadImage = uploadImage;
    imageStore.destroyImage = destroyImage;
    return { uploadImage, destroyImage, imageStore };
}

// Shared test plumbing: connect to the in-memory replica set, mint the JWT the
// auth middleware expects, and reset collections between tests.

export async function connectDb() {
    const uri = inject("mongoUri");
    if (mongoose.connection.readyState === 0) {
        await mongoose.connect(uri);
    }
    return mongoose.connection;
}

export async function disconnectDb() {
    if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.dropDatabase();
        await mongoose.disconnect();
    }
}

/** Wipe every collection so each test starts from a known empty state. */
export async function clearDb() {
    const { collections } = mongoose.connection;
    await Promise.all(
        Object.values(collections).map((c) => c.deleteMany({}))
    );
}

/**
 * A bearer token the real authUser middleware accepts.
 * Tests exercise the genuine auth path rather than stubbing req.user.
 */
export function tokenFor(userId) {
    return jwt.sign({ userId: String(userId) }, process.env.JWT_SECRET);
}

export function newUserId() {
    return new mongoose.Types.ObjectId();
}

export const auth = (userId) => ["Authorization", `Bearer ${tokenFor(userId)}`];
