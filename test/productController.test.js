import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";

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

// Set per test by stubImageStore(). Cloudinary is never contacted.
let uploadImage;
let destroyImage;

const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
);

let userId;

/** Create a product straight through the API and return its body. */
async function createProduct({ name = "ear buds", price = 100, totalStock = 20 } = {}) {
    const res = await request(app)
        .post("/api/product/add-product")
        .set(...auth(userId))
        .field("name", name)
        .field("price", String(price))
        .field("totalStock", String(totalStock))
        .attach("image", PNG, "pic.png");
    return res;
}

const adjust = (id, body) =>
    request(app)
        .post(`/api/product/adjust-stock/${id}`)
        .set(...auth(userId))
        .send({ idempotencyKey: `key-${Math.random().toString(36).slice(2)}`, ...body });

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
    vi.clearAllMocks();
    ({ uploadImage, destroyImage } = stubImageStore());
});

describe("auth", () => {
    it("rejects every product route without a token", async () => {
        const routes = [
            ["get", "/api/product/list-products"],
            ["get", "/api/product/audit-history"],
            ["get", "/api/product/stock-summary"],
            ["post", "/api/product/adjust-stock/123"],
        ];
        for (const [method, path] of routes) {
            const res = await request(app)[method](path);
            expect(res.status, `${method} ${path}`).toBe(401);
        }
    });
});

describe("addProduct", () => {
    it("creates a product and an opening ledger entry", async () => {
        const res = await createProduct();

        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({
            name: "ear buds",
            price: 100,
            currentStock: 20,
            totalPrice: 2000,
        });
        expect(res.body.data.image.publicId).toBe("test/pic");

        const logs = await ProductLog.find({ product: res.body.data._id }).lean();
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatchObject({
            action: "create",
            reason: "opening",
            delta: 20,
            stockBefore: 0,
            stockAfter: 20,
            productName: "ear buds",
        });
    });

    // The falsy-check regression. `if (!totalStock)` would reject this.
    it("accepts stock 0 (out of stock but still listed)", async () => {
        const res = await createProduct({ totalStock: 0 });
        expect(res.status).toBe(201);
        expect(res.body.data.currentStock).toBe(0);
        expect(res.body.data.totalPrice).toBe(0);
    });

    it("accepts price 0 (free promo item)", async () => {
        const res = await createProduct({ price: 0 });
        expect(res.status).toBe(201);
        expect(res.body.data.price).toBe(0);
    });

    it("requires an image", async () => {
        const res = await request(app)
            .post("/api/product/add-product")
            .set(...auth(userId))
            .field("name", "no photo")
            .field("price", "10")
            .field("totalStock", "5");

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/image is required/i);
    });

    it("rejects a non-numeric stock", async () => {
        const res = await createProduct({ totalStock: "abc" });
        expect(res.status).toBe(400);
        expect(res.body.fields.totalStock[0]).toMatch(/must be a number/i);
    });

    it("rejects an empty stock rather than silently reading it as 0", async () => {
        const res = await request(app)
            .post("/api/product/add-product")
            .set(...auth(userId))
            .field("name", "blank stock")
            .field("price", "10")
            .field("totalStock", "")
            .attach("image", PNG, "pic.png");

        expect(res.status).toBe(400);
        expect(res.body.fields.totalStock[0]).toMatch(/required/i);
    });

    it("rejects a fractional stock", async () => {
        const res = await createProduct({ totalStock: "1.5" });
        expect(res.status).toBe(400);
        expect(res.body.fields.totalStock[0]).toMatch(/whole number/i);
    });

    it("accepts an image up to the 15MB limit", async () => {
        const almostLimit = Buffer.alloc(14 * 1024 * 1024, 1);

        const res = await request(app)
            .post("/api/product/add-product")
            .set(...auth(userId))
            .field("name", "big photo")
            .field("price", "10")
            .field("totalStock", "5")
            .attach("image", almostLimit, "big.png");

        expect(res.status).toBe(201);
    });

    it("rejects an image over the limit with a size message, not a generic 500", async () => {
        const tooBig = Buffer.alloc(16 * 1024 * 1024, 1);

        const res = await request(app)
            .post("/api/product/add-product")
            .set(...auth(userId))
            .field("name", "huge photo")
            .field("price", "10")
            .field("totalStock", "5")
            .attach("image", tooBig, "huge.png");

        expect(res.status).toBe(413);
        expect(res.body.message).toMatch(/too large/i);
        expect(res.body.message).toMatch(/15MB/i);
    });

    // Our cap is generous enough that Cloudinary's own account limit can now
    // be the stricter of the two. Its rejection names the real ceiling, which
    // is far more actionable than "Internal Server Error".
    it("passes a Cloudinary size rejection through as 413 with its message", async () => {
        uploadImage.mockRejectedValueOnce(
            Object.assign(new Error("File size too large. Got 15728640. Maximum is 10485760."), {
                http_code: 400,
            })
        );

        const res = await createProduct();

        expect(res.status).toBe(413);
        expect(res.body.message).toMatch(/Maximum is 10485760/);
    });

    it("passes other Cloudinary 400s through as 400", async () => {
        uploadImage.mockRejectedValueOnce(
            Object.assign(new Error("Invalid image file"), { http_code: 400 })
        );

        const res = await createProduct();

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/invalid image file/i);
    });

    it("still returns 500 for a Cloudinary outage", async () => {
        uploadImage.mockRejectedValueOnce(new Error("socket hang up"));

        const res = await createProduct();

        expect(res.status).toBe(500);
    });

    it("cleans up the uploaded image when the write fails", async () => {
        const spy = vi.spyOn(Product, "create").mockRejectedValueOnce(new Error("boom"));
        const res = await createProduct();

        expect(res.status).toBe(500);
        expect(destroyImage).toHaveBeenCalledWith("test/pic");
        spy.mockRestore();
    });
});

describe("adjustStock", () => {
    it("walks the ear-buds example: 20 minus 10 plus 5 equals 15", async () => {
        const { body } = await createProduct();
        const id = body.data._id;

        const minus = await adjust(id, { delta: -10, reason: "order" });
        expect(minus.status).toBe(200);
        expect(minus.body.data.currentStock).toBe(10);

        const plus = await adjust(id, { delta: 5, reason: "return" });
        expect(plus.status).toBe(200);
        expect(plus.body.data.currentStock).toBe(15);
        expect(plus.body.data.totalPrice).toBe(1500);

        const logs = await ProductLog.find({ product: id }).sort({ at: 1 }).lean();
        expect(logs.map((l) => [l.delta, l.stockBefore, l.stockAfter])).toEqual([
            [20, 0, 20],
            [-10, 20, 10],
            [5, 10, 15],
        ]);
    });

    it("refuses to oversell and leaves stock untouched", async () => {
        const { body } = await createProduct({ totalStock: 15 });
        const id = body.data._id;

        const res = await adjust(id, { delta: -20, reason: "order" });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/only 15 in stock/i);

        const after = await Product.findById(id).lean();
        expect(after.currentStock).toBe(15);

        // Critically: a rejected adjustment writes NO ledger entry.
        const adjustments = await ProductLog.countDocuments({ action: "adjust" });
        expect(adjustments).toBe(0);
    });

    it("allows draining to exactly zero", async () => {
        const { body } = await createProduct({ totalStock: 8 });
        const res = await adjust(body.data._id, { delta: -8, reason: "order" });

        expect(res.status).toBe(200);
        expect(res.body.data.currentStock).toBe(0);
    });

    it("returns 404 for an unknown or malformed id, not a stock error", async () => {
        const missing = await adjust(newUserId(), { delta: -1, reason: "order" });
        expect(missing.status).toBe(404);

        const malformed = await adjust("not-an-id", { delta: -1, reason: "order" });
        expect(malformed.status).toBe(404);
    });

    it("returns 404 for another user's product rather than adjusting it", async () => {
        const { body } = await createProduct();
        const id = body.data._id;

        const stranger = newUserId();
        const res = await request(app)
            .post(`/api/product/adjust-stock/${id}`)
            .set(...auth(stranger))
            .send({ delta: -5, reason: "order", idempotencyKey: "stranger-key-1" });

        expect(res.status).toBe(404);
        const after = await Product.findById(id).lean();
        expect(after.currentStock).toBe(20);
    });

    it("rejects a zero delta", async () => {
        const { body } = await createProduct();
        const res = await adjust(body.data._id, { delta: 0, reason: "correction" });
        expect(res.status).toBe(400);
        expect(res.body.fields.delta[0]).toMatch(/cannot be zero/i);
    });

    it("rejects a reason whose sign is wrong", async () => {
        const { body } = await createProduct();
        const id = body.data._id;

        const badOrder = await adjust(id, { delta: 10, reason: "order" });
        expect(badOrder.status).toBe(400);
        expect(badOrder.body.fields.delta[0]).toMatch(/order must reduce stock/i);

        const badReturn = await adjust(id, { delta: -5, reason: "return" });
        expect(badReturn.status).toBe(400);
        expect(badReturn.body.fields.delta[0]).toMatch(/must increase stock/i);
    });

    it("allows a correction in either direction", async () => {
        const { body } = await createProduct();
        const id = body.data._id;

        expect((await adjust(id, { delta: -3, reason: "correction" })).status).toBe(200);
        expect((await adjust(id, { delta: 3, reason: "correction" })).status).toBe(200);
    });

    it("rejects an unknown reason", async () => {
        const { body } = await createProduct();
        const res = await adjust(body.data._id, { delta: -1, reason: "shrinkage" });
        expect(res.status).toBe(400);
    });

    it("applies a repeated idempotency key only once", async () => {
        const { body } = await createProduct();
        const id = body.data._id;
        const payload = { delta: -10, reason: "order", idempotencyKey: "same-key-abc123" };

        const first = await request(app)
            .post(`/api/product/adjust-stock/${id}`)
            .set(...auth(userId))
            .send(payload);
        const second = await request(app)
            .post(`/api/product/adjust-stock/${id}`)
            .set(...auth(userId))
            .send(payload);

        expect(first.status).toBe(200);
        expect(first.body.data.currentStock).toBe(10);

        expect(second.status).toBe(200);
        expect(second.body.data.currentStock).toBe(10);
        expect(second.body.data.duplicate).toBe(true);

        const after = await Product.findById(id).lean();
        expect(after.currentStock).toBe(10);
        expect(await ProductLog.countDocuments({ action: "adjust" })).toBe(1);
    });

    it("survives concurrent submissions of the same key", async () => {
        const { body } = await createProduct();
        const id = body.data._id;
        const payload = { delta: -10, reason: "order", idempotencyKey: "race-key-xyz789" };

        const send = () =>
            request(app)
                .post(`/api/product/adjust-stock/${id}`)
                .set(...auth(userId))
                .send(payload);

        const results = await Promise.all([send(), send(), send()]);

        expect(results.every((r) => r.status === 200)).toBe(true);
        const after = await Product.findById(id).lean();
        expect(after.currentStock).toBe(10);
        expect(await ProductLog.countDocuments({ action: "adjust" })).toBe(1);
    });

    it("lets two different keys both apply, and stops at the guard", async () => {
        const { body } = await createProduct({ totalStock: 15 });
        const id = body.data._id;

        const a = await adjust(id, { delta: -10, reason: "order" });
        const b = await adjust(id, { delta: -10, reason: "order" });

        expect(a.status).toBe(200);
        expect(a.body.data.currentStock).toBe(5);
        // The second is a genuinely separate action, and the guard is what
        // stops it -- not the idempotency key.
        expect(b.status).toBe(400);
        expect(b.body.message).toMatch(/only 5 in stock/i);
    });

    it("requires an idempotency key", async () => {
        const { body } = await createProduct();
        const res = await request(app)
            .post(`/api/product/adjust-stock/${body.data._id}`)
            .set(...auth(userId))
            .send({ delta: -1, reason: "order" });

        expect(res.status).toBe(400);
        expect(res.body.fields.idempotencyKey[0]).toMatch(/required/i);
    });

    it("rolls back the stock change when the ledger write fails", async () => {
        const { body } = await createProduct();
        const id = body.data._id;

        const spy = vi
            .spyOn(ProductLog, "create")
            .mockRejectedValueOnce(new Error("ledger unavailable"));

        const res = await adjust(id, { delta: -10, reason: "order" });
        expect(res.status).toBe(500);

        // The whole point of the transaction: stock did NOT move.
        const after = await Product.findById(id).lean();
        expect(after.currentStock).toBe(20);
        spy.mockRestore();
    });
});

describe("listProducts", () => {
    it("returns an empty list, not an error", async () => {
        const res = await request(app)
            .get("/api/product/list-products")
            .set(...auth(userId));

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([]);
    });

    it("computes totalPrice from CURRENT stock", async () => {
        const { body } = await createProduct({ price: 99.99, totalStock: 20 });
        await adjust(body.data._id, { delta: -5, reason: "order" });

        const res = await request(app)
            .get("/api/product/list-products")
            .set(...auth(userId));

        expect(res.body.data[0].currentStock).toBe(15);
        expect(res.body.data[0].totalPrice).toBeCloseTo(1499.85, 2);
    });

    it("never returns another user's products", async () => {
        await createProduct({ name: "mine" });

        const stranger = newUserId();
        const res = await request(app)
            .get("/api/product/list-products")
            .set(...auth(stranger));

        expect(res.body.data).toEqual([]);
    });
});

describe("updateProduct", () => {
    it("records a field-level diff for a name change", async () => {
        const { body } = await createProduct();
        const id = body.data._id;

        const res = await request(app)
            .put(`/api/product/update-product/${id}`)
            .set(...auth(userId))
            .field("name", "ear buds pro");

        expect(res.status).toBe(200);
        expect(res.body.data.name).toBe("ear buds pro");

        const log = await ProductLog.findOne({ action: "update" }).lean();
        expect(log.changes).toEqual([
            { field: "name", from: "ear buds", to: "ear buds pro" },
        ]);
        expect(log.delta).toBe(0);
    });

    // The whitelist. An edit must never be able to move stock.
    it("ignores any attempt to write stock through the edit endpoint", async () => {
        const { body } = await createProduct({ totalStock: 20 });
        const id = body.data._id;

        await request(app)
            .put(`/api/product/update-product/${id}`)
            .set(...auth(userId))
            .field("name", "renamed")
            .field("currentStock", "9999")
            .field("totalStock", "9999");

        const after = await Product.findById(id).lean();
        expect(after.currentStock).toBe(20);
    });

    it("destroys the previous image only after the write commits", async () => {
        const { body } = await createProduct();

        await request(app)
            .put(`/api/product/update-product/${body.data._id}`)
            .set(...auth(userId))
            .attach("image", PNG, "new.png");

        expect(uploadImage).toHaveBeenCalledTimes(2);
        expect(destroyImage).toHaveBeenCalledWith("test/pic");
    });

    it("404s for another user's product", async () => {
        const { body } = await createProduct();
        const stranger = newUserId();

        const res = await request(app)
            .put(`/api/product/update-product/${body.data._id}`)
            .set(...auth(stranger))
            .field("name", "hijacked");

        expect(res.status).toBe(404);
    });
});

describe("deleteProduct", () => {
    it("removes the product, keeps readable history, and frees the image", async () => {
        const { body } = await createProduct();
        const id = body.data._id;

        const res = await request(app)
            .delete(`/api/product/delete-product/${id}`)
            .set(...auth(userId));

        expect(res.status).toBe(200);
        expect(await Product.findById(id)).toBeNull();
        expect(destroyImage).toHaveBeenCalledWith("test/pic");

        // History survives the product, and still says what it was called.
        const log = await ProductLog.findOne({ action: "delete" }).lean();
        expect(log.productName).toBe("ear buds");
        expect(log.stockBefore).toBe(20);
        expect(log.stockAfter).toBe(0);
    });

    it("404s for another user's product", async () => {
        const { body } = await createProduct();
        const stranger = newUserId();

        const res = await request(app)
            .delete(`/api/product/delete-product/${body.data._id}`)
            .set(...auth(stranger));

        expect(res.status).toBe(404);
        expect(await Product.findById(body.data._id)).not.toBeNull();
    });
});

describe("getAuditHistory", () => {
    it("pages newest first and reports totals", async () => {
        const { body } = await createProduct({ totalStock: 100 });
        const id = body.data._id;
        for (let i = 0; i < 5; i++) {
            await adjust(id, { delta: -1, reason: "order" });
        }

        const res = await request(app)
            .get("/api/product/audit-history?page=1&limit=2")
            .set(...auth(userId));

        expect(res.status).toBe(200);
        expect(res.body.data.items).toHaveLength(2);
        expect(res.body.data.total).toBe(6); // 1 opening + 5 adjustments
        expect(res.body.data.totalPages).toBe(3);
    });

    it("returns an empty page past the end instead of crashing", async () => {
        await createProduct();
        const res = await request(app)
            .get("/api/product/audit-history?page=99&limit=20")
            .set(...auth(userId));

        expect(res.status).toBe(200);
        expect(res.body.data.items).toEqual([]);
    });

    it("rejects an out-of-range limit", async () => {
        const res = await request(app)
            .get("/api/product/audit-history?limit=5000")
            .set(...auth(userId));
        expect(res.status).toBe(400);
    });

    it("never leaks another user's history", async () => {
        await createProduct();
        const stranger = newUserId();

        const res = await request(app)
            .get("/api/product/audit-history")
            .set(...auth(stranger));

        expect(res.body.data.items).toEqual([]);
    });
});
