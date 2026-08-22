// Disposable backend for the Playwright end-to-end run.
//
// Boots the real Express app, but against throwaway infrastructure:
//
//   real app.js  ->  in-memory replica set   (never your Atlas data)
//                ->  stubbed image store     (never your Cloudinary account)
//
// Everything else -- routing, auth middleware, multer, zod, the transaction,
// the guard, the idempotency key -- is the genuine production code path. Only
// the two external systems are swapped.
//
// A seeded user's JWT is written to .e2e-token.json so the Playwright setup
// can put it in localStorage and start the app already signed in.

import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { createRequire } from "module";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.E2E_PORT || 8099);
const JWT_SECRET = process.env.JWT_SECRET || "e2e-test-secret";

process.env.JWT_SECRET = JWT_SECRET;
process.env.APP_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Kolkata";

const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
await mongoose.connect(replSet.getUri());

// Swap the image store on the exact CJS module instance the controller holds.
// A 1x1 PNG is enough: nothing in the flow inspects the bytes.
const imageStore = require("../src/config/cloudinary.js");
let uploadCount = 0;
imageStore.uploadImage = async () => {
    uploadCount += 1;
    return {
        url: `https://res.cloudinary.com/demo/image/upload/v1/e2e/pic-${uploadCount}.png`,
        publicId: `e2e/pic-${uploadCount}`,
    };
};
imageStore.destroyImage = async () => ({ ok: true });

const app = require("../app.js");

const userId = new mongoose.Types.ObjectId();
const token = jwt.sign({ userId: String(userId) }, JWT_SECRET);

// Harness-only route: hand out a token for a brand new user.
//
// Defined HERE, not in app.js, so it exists only in this throwaway process and
// can never reach production. Each test takes a fresh account, which keeps
// account-wide figures (the movement chart totals) independent of whatever
// other tests did before it.
app.get("/__test__/new-user", (req, res) => {
    const id = new mongoose.Types.ObjectId();
    res.json({ token: jwt.sign({ userId: String(id) }, JWT_SECRET), userId: String(id) });
});

writeFileSync(
    path.join(__dirname, "..", ".e2e-token.json"),
    JSON.stringify({ token, userId: String(userId), apiBaseUrl: `http://localhost:${PORT}/api` }, null, 2)
);

const server = app.listen(PORT, () => {
    // Playwright's webServer waits for this line before starting the tests.
    console.log(`E2E backend ready on ${PORT}`);
});

const shutdown = async () => {
    server.close();
    await mongoose.disconnect();
    await replSet.stop();
    process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
