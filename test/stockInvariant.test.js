import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import mongoose from "mongoose";

import {
    connectDb,
    disconnectDb,
    clearDb,
    auth,
    newUserId,
    stubImageStore,
} from "./helpers.mjs";

const app = (await import("../app.js")).default;
const Product = (await import("../src/models/product.js")).default;
const ProductLog = (await import("../src/models/productLog.js")).default;

// THE invariant.
//
//   product.currentStock === SUM(ProductLog.delta for that product)
//
// Everything else in this feature is arranged to make this true: the opening
// entry, the guarded $inc, the transaction, the idempotency key, and the
// update whitelist. If this test passes after a long random sequence, the
// stock number and its own history agree -- which is the only claim the
// Product Stock page really makes.

const PNG = Buffer.from("iVBORw0KGgo=", "base64");

let userId;

beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
    process.env.APP_TIMEZONE = "Asia/Kolkata";
    await connectDb();
});

afterAll(async () => {
    await disconnectDb();
});

beforeEach(async () => {
    await clearDb();
    userId = newUserId();
    stubImageStore();
});

/** Sum every ledger delta for a product, straight from the database. */
async function ledgerSum(productId) {
    const [row] = await ProductLog.aggregate([
        { $match: { product: new mongoose.Types.ObjectId(productId) } },
        { $group: { _id: null, sum: { $sum: "$delta" } } },
    ]);
    return row ? row.sum : 0;
}

async function createProduct(totalStock) {
    const res = await request(app)
        .post("/api/product/add-product")
        .set(...auth(userId))
        .field("name", "ear buds")
        .field("price", "100")
        .field("totalStock", String(totalStock))
        .attach("image", PNG, "pic.png");
    return res.body.data._id;
}

describe("stock invariant", () => {
    it("holds immediately after creation", async () => {
        const id = await createProduct(20);
        const product = await Product.findById(id).lean();
        expect(await ledgerSum(id)).toBe(product.currentStock);
    });

    it("holds across 100 random accepted and rejected adjustments", async () => {
        const id = await createProduct(500);

        let applied = 0;
        let rejected = 0;

        for (let i = 0; i < 100; i++) {
            // Deliberately unbalanced towards removal so the guard fires and
            // rejections are part of the sequence, not just happy paths.
            const magnitude = 1 + Math.floor(Math.random() * 40);
            const removing = Math.random() < 0.6;
            const delta = removing ? -magnitude : magnitude;
            const reason = removing ? "order" : "return";

            const res = await request(app)
                .post(`/api/product/adjust-stock/${id}`)
                .set(...auth(userId))
                .send({ delta, reason, idempotencyKey: `inv-${i}-${Math.random()}` });

            if (res.status === 200) applied++;
            else {
                rejected++;
                expect(res.status).toBe(400);
                expect(res.body.message).toMatch(/in stock/i);
            }
        }

        const product = await Product.findById(id).lean();

        // The invariant itself.
        expect(await ledgerSum(id)).toBe(product.currentStock);

        // Stock never went negative, whatever the sequence.
        expect(product.currentStock).toBeGreaterThanOrEqual(0);

        // A rejected adjustment must leave no trace in the ledger.
        const adjustments = await ProductLog.countDocuments({
            product: id,
            action: "adjust",
        });
        expect(adjustments).toBe(applied);
        expect(applied + rejected).toBe(100);
    });

    it("holds when many adjustments run concurrently", async () => {
        const id = await createProduct(100);

        // 20 simultaneous removals of 10 against a stock of 100. Exactly 10
        // can succeed. Read-modify-write would let more through and drive the
        // number negative; the guarded $inc cannot.
        const attempts = Array.from({ length: 20 }, (_, i) =>
            request(app)
                .post(`/api/product/adjust-stock/${id}`)
                .set(...auth(userId))
                .send({ delta: -10, reason: "order", idempotencyKey: `concurrent-key-${i}` })
        );

        const results = await Promise.all(attempts);
        const ok = results.filter((r) => r.status === 200).length;

        expect(ok).toBe(10);

        const product = await Product.findById(id).lean();
        expect(product.currentStock).toBe(0);
        expect(await ledgerSum(id)).toBe(product.currentStock);
    });

    it("is not broken by an edit, because edits cannot write stock", async () => {
        const id = await createProduct(20);

        await request(app)
            .put(`/api/product/update-product/${id}`)
            .set(...auth(userId))
            .field("name", "renamed")
            .field("price", "250")
            .field("currentStock", "9999");

        const product = await Product.findById(id).lean();
        expect(product.currentStock).toBe(20);
        expect(await ledgerSum(id)).toBe(product.currentStock);
    });
});
