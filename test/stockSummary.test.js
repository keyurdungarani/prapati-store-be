import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import moment from "moment-timezone";

const app = (await import("../app.js")).default;
const ProductLog = (await import("../src/models/productLog.js")).default;

import {
    connectDb,
    disconnectDb,
    clearDb,
    auth,
    newUserId,
    stubImageStore,
} from "./helpers.mjs";
import { isValidTimezone, assertValidTimezone, dayRange } from "../src/config/businessTime.js";

const PNG = Buffer.from("iVBORw0KGgo=", "base64");
const TZ = "Asia/Kolkata";

let userId;

beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
    process.env.APP_TIMEZONE = TZ;
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

const summary = (qs = "") =>
    request(app)
        .get(`/api/product/stock-summary${qs}`)
        .set(...auth(userId));

async function createProduct(totalStock = 100) {
    const res = await request(app)
        .post("/api/product/add-product")
        .set(...auth(userId))
        .field("name", "ear buds")
        .field("price", "100")
        .field("totalStock", String(totalStock))
        .attach("image", PNG, "pic.png");
    return res.body.data._id;
}

const adjust = (id, delta, reason) =>
    request(app)
        .post(`/api/product/adjust-stock/${id}`)
        .set(...auth(userId))
        .send({ delta, reason, idempotencyKey: `sum-${Math.random()}` });

/** Write a ledger entry directly at a chosen instant. */
async function logAt(productId, delta, at) {
    await ProductLog.create({
        user: userId,
        product: productId,
        productName: "ear buds",
        action: "adjust",
        reason: delta < 0 ? "order" : "return",
        delta,
        stockBefore: 0,
        stockAfter: delta,
        at,
    });
}

describe("business timezone config", () => {
    it("recognises a real zone and rejects a typo", () => {
        expect(isValidTimezone("Asia/Kolkata")).toBe(true);
        expect(isValidTimezone("Bad/Zone")).toBe(false);
        expect(isValidTimezone("")).toBe(false);
        expect(isValidTimezone(undefined)).toBe(false);
    });

    it("throws rather than returning silently for an invalid zone", () => {
        const original = process.env.APP_TIMEZONE;
        process.env.APP_TIMEZONE = "Not/AZone";
        expect(() => assertValidTimezone({ exit: false })).toThrow(/not a known timezone/i);
        process.env.APP_TIMEZONE = original;
    });

    it("bounds the day in IST, not in the server's own zone", () => {
        const { start, end } = dayRange();
        // IST is UTC+5:30, so local midnight is 18:30 UTC the previous day.
        expect(moment(start).tz(TZ).format("HH:mm")).toBe("00:00");
        expect(moment(end).tz(TZ).format("HH:mm")).toBe("23:59");
    });
});

describe("getStockSummary", () => {
    it("reports zeros for a quiet day instead of an empty payload", async () => {
        const res = await summary();

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ plus: 0, minus: 0, net: 0, movements: 0 });
        expect(res.body.data.byReason).toEqual([]);
    });

    it("splits today's movements into plus and minus", async () => {
        const id = await createProduct(100);
        await adjust(id, -10, "order");
        await adjust(id, -3, "order");
        await adjust(id, 5, "return");

        const res = await summary();

        expect(res.body.data.plus).toBe(5);
        expect(res.body.data.minus).toBe(13);
        expect(res.body.data.net).toBe(-8);
        expect(res.body.data.movements).toBe(3);
    });

    it("breaks the day down by reason", async () => {
        const id = await createProduct(100);
        await adjust(id, -10, "order");
        await adjust(id, 5, "return");
        await adjust(id, 20, "restock");

        const { body } = await summary();
        const byReason = Object.fromEntries(
            body.data.byReason.map((r) => [r.reason, r.total])
        );

        expect(byReason).toEqual({ order: 10, return: 5, restock: 20 });
    });

    it("excludes the opening entry, which is not a daily movement", async () => {
        await createProduct(500);
        const res = await summary();

        // Creating a product with 500 units must not show up as "+500 today".
        expect(res.body.data.plus).toBe(0);
        expect(res.body.data.movements).toBe(0);
    });

    // The bug this whole timezone decision exists to prevent.
    it("counts a 01:00 IST movement as TODAY, not yesterday", async () => {
        const id = await createProduct(100);

        // 01:00 IST today is 19:30 UTC *yesterday*. A server computing days in
        // UTC would file this under the previous date and show an empty graph
        // during early-morning stock updates.
        const earlyToday = moment.tz(TZ).startOf("day").add(1, "hour");
        await logAt(id, -7, earlyToday.toDate());

        const res = await summary();

        expect(res.body.data.minus).toBe(7);
        expect(res.body.data.movements).toBe(1);
    });

    it("excludes a movement from just before midnight yesterday", async () => {
        const id = await createProduct(100);

        const lateYesterday = moment.tz(TZ).startOf("day").subtract(1, "minute");
        await logAt(id, -99, lateYesterday.toDate());

        const res = await summary();
        expect(res.body.data.minus).toBe(0);
        expect(res.body.data.movements).toBe(0);
    });

    it("honours an explicit from/to range", async () => {
        const id = await createProduct(100);
        const threeDaysAgo = moment.tz(TZ).subtract(3, "days").startOf("day").add(9, "hours");
        await logAt(id, -42, threeDaysAgo.toDate());

        const day = threeDaysAgo.format("YYYY-MM-DD");
        const res = await summary(`?from=${day}&to=${day}`);

        expect(res.body.data.minus).toBe(42);
    });

    // Without new Types.ObjectId the $match matches nothing and the endpoint
    // returns zeros with no error at all -- a silently wrong graph.
    it("casts the user id so $match actually matches", async () => {
        const id = await createProduct(100);
        await adjust(id, -10, "order");

        const raw = await ProductLog.aggregate([
            { $match: { user: String(userId), action: "adjust" } },
            { $group: { _id: null, n: { $sum: 1 } } },
        ]);
        // Proof the trap is real: the uncast string matches zero documents.
        expect(raw).toEqual([]);

        const cast = await ProductLog.aggregate([
            { $match: { user: new mongoose.Types.ObjectId(userId), action: "adjust" } },
            { $group: { _id: null, n: { $sum: 1 } } },
        ]);
        expect(cast[0].n).toBe(1);

        // And the endpoint uses the cast form.
        const res = await summary();
        expect(res.body.data.minus).toBe(10);
    });

    it("never counts another user's movements", async () => {
        const id = await createProduct(100);
        await adjust(id, -10, "order");

        const stranger = newUserId();
        const res = await request(app)
            .get("/api/product/stock-summary")
            .set(...auth(stranger));

        expect(res.body.data.minus).toBe(0);
    });
});
