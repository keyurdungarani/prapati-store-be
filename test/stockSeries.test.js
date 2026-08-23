import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import moment from "moment-timezone";

import {
    connectDb,
    disconnectDb,
    clearDb,
    auth,
    newUserId,
    stubImageStore,
} from "./helpers.mjs";

const app = (await import("../app.js")).default;
const ProductLog = (await import("../src/models/productLog.js")).default;

import { seriesRange, bucketsBetween } from "../src/config/businessTime.js";

// Daily / monthly movement series for the chart.
//
// Two things are being proven: that the grouping happens in the business
// timezone, and that every bucket in the window is present even when nothing
// moved -- a missing day would make the chart quietly misleading.

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

const series = (qs = "") =>
    request(app)
        .get(`/api/product/stock-series${qs}`)
        .set(...auth(userId));

async function createProduct(totalStock = 1000, price = 100) {
    const res = await request(app)
        .post("/api/product/add-product")
        .set(...auth(userId))
        .field("name", "ear buds")
        .field("price", String(price))
        .field("totalStock", String(totalStock))
        .attach("image", PNG, "pic.png");
    return res.body.data._id;
}

const adjust = (id, delta, reason) =>
    request(app)
        .post(`/api/product/adjust-stock/${id}`)
        .set(...auth(userId))
        .send({ delta, reason, idempotencyKey: `series-${Math.random()}` });

/** Write a ledger entry directly at a chosen instant. */
async function logAt(productId, delta, at, unitPrice = 100) {
    await ProductLog.create({
        user: userId,
        product: productId,
        productName: "ear buds",
        action: "adjust",
        reason: delta < 0 ? "order" : "return",
        delta,
        unitPrice,
        stockBefore: 0,
        stockAfter: delta,
        at,
    });
}

const bucketFor = (body, key) => body.data.buckets.find((b) => b.key === key);

describe("bucketing helpers", () => {
    it("defaults daily to the current month and monthly to 12 months", () => {
        const daily = seriesRange({ period: "daily" });
        expect(moment(daily.start).tz(TZ).date()).toBe(1);
        expect(moment(daily.start).tz(TZ).month()).toBe(moment.tz(TZ).month());

        const monthly = seriesRange({ period: "monthly" });
        const months = moment(monthly.end).tz(TZ).diff(moment(monthly.start).tz(TZ), "months");
        expect(months).toBe(11); // 12 buckets inclusive
    });

    it("produces one bucket per day, inclusive of both ends", () => {
        const start = moment.tz("2026-03-01", TZ).startOf("day").toDate();
        const end = moment.tz("2026-03-05", TZ).endOf("day").toDate();
        const buckets = bucketsBetween(start, end, "daily");

        expect(buckets).toHaveLength(5);
        expect(buckets[0].key).toBe("2026-03-01");
        expect(buckets[4].key).toBe("2026-03-05");
        expect(buckets[0].label).toBe("01 Mar");
    });

    it("produces one bucket per month", () => {
        const start = moment.tz("2026-01-01", TZ).startOf("month").toDate();
        const end = moment.tz("2026-03-31", TZ).endOf("month").toDate();
        const buckets = bucketsBetween(start, end, "monthly");

        expect(buckets.map((b) => b.key)).toEqual(["2026-01", "2026-02", "2026-03"]);
        expect(buckets[0].label).toBe("Jan 26");
    });
});

describe("getStockSeries", () => {
    it("defaults to daily and covers the whole current month", async () => {
        const res = await series();

        expect(res.status).toBe(200);
        expect(res.body.data.period).toBe("daily");

        const daysInMonth = moment.tz(TZ).daysInMonth();
        expect(res.body.data.buckets).toHaveLength(daysInMonth);
    });

    it("rejects an unknown period", async () => {
        const res = await series("?period=hourly");
        expect(res.status).toBe(400);
        expect(res.body.fields.period[0]).toMatch(/daily or monthly/i);
    });

    it("splits a day into plus and minus with their values", async () => {
        const id = await createProduct(1000, 100);
        await adjust(id, -10, "order");
        await adjust(id, 4, "return");

        const today = moment.tz(TZ).format("YYYY-MM-DD");
        const { body } = await series();
        const bucket = bucketFor(body, today);

        expect(bucket.minus).toBe(10);
        expect(bucket.plus).toBe(4);
        expect(bucket.net).toBe(-6);

        // 10 x 100 out, 4 x 100 in.
        expect(bucket.minusValue).toBe(1000);
        expect(bucket.plusValue).toBe(400);
        expect(bucket.totalValue).toBe(1400);
        expect(bucket.netValue).toBe(-600);
        expect(bucket.movements).toBe(2);
    });

    // A day with no movement must still appear, otherwise the chart's x-axis
    // silently skips days and the shape of the data is a lie.
    it("pads days that saw no movement with zeros", async () => {
        const id = await createProduct(1000, 100);
        await adjust(id, -5, "order");

        const { body } = await series();
        const today = moment.tz(TZ).format("YYYY-MM-DD");

        expect(body.data.buckets.every((b) => typeof b.plus === "number")).toBe(true);

        const quiet = body.data.buckets.filter((b) => b.key !== today);
        expect(quiet.length).toBeGreaterThan(0);
        expect(quiet.every((b) => b.plus === 0 && b.minus === 0 && b.movements === 0)).toBe(true);
    });

    it("uses the price snapshotted on the entry, not the product's current price", async () => {
        const id = await createProduct(1000, 100);
        await adjust(id, -10, "order"); // worth 10 x 100 = 1000

        // Reprice the product afterwards.
        await request(app)
            .put(`/api/product/update-product/${id}`)
            .set(...auth(userId))
            .field("price", "250");

        const today = moment.tz(TZ).format("YYYY-MM-DD");
        const { body } = await series();

        // Still 1000, not 2500. History is not restated by a price change.
        expect(bucketFor(body, today).minusValue).toBe(1000);
    });

    it("counts a 01:00 IST movement on today's bucket, not yesterday's", async () => {
        const id = await createProduct(1000, 100);
        const earlyToday = moment.tz(TZ).startOf("day").add(1, "hour");
        await logAt(id, -7, earlyToday.toDate());

        const { body } = await series();
        const today = moment.tz(TZ).format("YYYY-MM-DD");

        expect(bucketFor(body, today).minus).toBe(7);
    });

    it("excludes the opening entry, which is data entry rather than movement", async () => {
        await createProduct(500, 100);

        const { body } = await series();
        expect(body.data.totals.plus).toBe(0);
        expect(body.data.totals.movements).toBe(0);
    });

    it("groups by month when asked", async () => {
        const id = await createProduct(1000, 50);
        const twoMonthsAgo = moment.tz(TZ).subtract(2, "months").startOf("month").add(9, "hours");
        await logAt(id, -20, twoMonthsAgo.toDate(), 50);
        await adjust(id, -5, "order");

        const { body } = await series("?period=monthly");

        expect(body.data.period).toBe("monthly");
        expect(body.data.buckets).toHaveLength(12);

        const oldKey = twoMonthsAgo.format("YYYY-MM");
        expect(bucketFor(body, oldKey).minus).toBe(20);
        expect(bucketFor(body, oldKey).minusValue).toBe(1000);

        const thisKey = moment.tz(TZ).format("YYYY-MM");
        expect(bucketFor(body, thisKey).minus).toBe(5);
    });

    it("honours an explicit from/to window", async () => {
        const id = await createProduct(1000, 100);
        // startOf("day") first, THEN add hours. Without it the entry inherits
        // the current time of day, and +9h crosses midnight whenever the suite
        // runs after 15:00 -- pushing the entry out of the requested window and
        // failing only in the afternoon.
        const target = moment.tz(TZ).subtract(3, "days").startOf("day");
        await logAt(id, -42, target.clone().add(9, "hours").toDate());

        const day = target.format("YYYY-MM-DD");
        const { body } = await series(`?from=${day}&to=${day}`);

        expect(body.data.buckets).toHaveLength(1);
        expect(body.data.buckets[0].minus).toBe(42);
        expect(body.data.totals.minus).toBe(42);
    });

    it("totals every bucket in the window", async () => {
        const id = await createProduct(1000, 10);
        await adjust(id, -10, "order");
        await adjust(id, -5, "order");
        await adjust(id, 3, "return");

        const { body } = await series();

        expect(body.data.totals.minus).toBe(15);
        expect(body.data.totals.plus).toBe(3);
        expect(body.data.totals.net).toBe(-12);
        expect(body.data.totals.minusValue).toBe(150);
        expect(body.data.totals.plusValue).toBe(30);
        expect(body.data.totals.totalValue).toBe(180);
        expect(body.data.totals.movements).toBe(3);
    });

    it("treats an entry with no unitPrice as zero value rather than failing", async () => {
        const id = await createProduct(1000, 100);
        await ProductLog.collection.insertOne({
            user: userId,
            product: id,
            productName: "legacy",
            action: "adjust",
            reason: "order",
            delta: -6,
            stockBefore: 10,
            stockAfter: 4,
            at: new Date(),
            // unitPrice deliberately absent, as pre-backfill rows are
        });

        const today = moment.tz(TZ).format("YYYY-MM-DD");
        const { body } = await series();

        expect(bucketFor(body, today).minus).toBe(6);
        expect(bucketFor(body, today).minusValue).toBe(0);
    });

    it("never includes another user's movements", async () => {
        const id = await createProduct(1000, 100);
        await adjust(id, -10, "order");

        const stranger = newUserId();
        const res = await request(app)
            .get("/api/product/stock-series")
            .set(...auth(stranger));

        expect(res.body.data.totals.minus).toBe(0);
    });

    it("requires a token", async () => {
        const res = await request(app).get("/api/product/stock-series");
        expect(res.status).toBe(401);
    });
});
