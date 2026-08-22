import { describe, it, expect } from "vitest";
import {
    createProductSchema,
    updateProductSchema,
    adjustStockSchema,
    auditQuerySchema,
    validate,
} from "../src/validation/productSchema.js";

// Pure validation. No database, no network.
//
// The cases that matter most are the ones the house `if (!x)` pattern gets
// wrong (zero) and the one z.coerce.number() gets wrong (empty string, which
// Number() turns into 0).

const ok = (schema, input) => {
    const r = validate(schema, input);
    expect(r.ok, JSON.stringify(r.fields)).toBe(true);
    return r.data;
};

const fail = (schema, input, field) => {
    const r = validate(schema, input);
    expect(r.ok).toBe(false);
    if (field) expect(r.fields[field]).toBeDefined();
    return r;
};

const base = { name: "ear buds", price: "100", totalStock: "20" };

describe("createProductSchema", () => {
    it("coerces multipart strings into numbers", () => {
        const d = ok(createProductSchema, base);
        expect(d).toEqual({ name: "ear buds", price: 100, totalStock: 20 });
    });

    it("trims whitespace around values", () => {
        const d = ok(createProductSchema, { name: "  ear buds  ", price: " 100 ", totalStock: " 20 " });
        expect(d.name).toBe("ear buds");
        expect(d.totalStock).toBe(20);
    });

    // The regression the house pattern would reintroduce.
    it("accepts zero stock and zero price", () => {
        const d = ok(createProductSchema, { name: "freebie", price: "0", totalStock: "0" });
        expect(d.price).toBe(0);
        expect(d.totalStock).toBe(0);
    });

    // The bug z.coerce.number() has: Number("") === 0.
    it("rejects an empty string instead of reading it as zero", () => {
        const r = fail(createProductSchema, { ...base, totalStock: "" }, "totalStock");
        expect(r.fields.totalStock[0]).toMatch(/required/i);

        const p = fail(createProductSchema, { ...base, price: "" }, "price");
        expect(p.fields.price[0]).toMatch(/required/i);
    });

    it("rejects missing fields", () => {
        fail(createProductSchema, {}, "name");
        fail(createProductSchema, { name: "x", price: "1" }, "totalStock");
    });

    it("rejects a blank name", () => {
        fail(createProductSchema, { ...base, name: "   " }, "name");
    });

    it("rejects text, decimals and negatives for stock", () => {
        expect(fail(createProductSchema, { ...base, totalStock: "abc" }).fields.totalStock[0])
            .toMatch(/must be a number/i);
        expect(fail(createProductSchema, { ...base, totalStock: "1.5" }).fields.totalStock[0])
            .toMatch(/whole number/i);
        expect(fail(createProductSchema, { ...base, totalStock: "-3" }).fields.totalStock[0])
            .toMatch(/negative/i);
    });

    it("rejects booleans, which Number() would happily turn into 1", () => {
        fail(createProductSchema, { ...base, totalStock: true }, "totalStock");
    });

    it("allows a decimal price but not a negative one", () => {
        expect(ok(createProductSchema, { ...base, price: "99.99" }).price).toBeCloseTo(99.99);
        fail(createProductSchema, { ...base, price: "-1" }, "price");
    });

    it("rejects absurdly large values", () => {
        fail(createProductSchema, { ...base, totalStock: "999999999999" }, "totalStock");
    });
});

describe("updateProductSchema", () => {
    it("has no stock field at all, so stock can never be edited", () => {
        const d = ok(updateProductSchema, { name: "new", currentStock: "9999", totalStock: "9999" });
        expect(d).toEqual({ name: "new" });
        expect(d.currentStock).toBeUndefined();
        expect(d.totalStock).toBeUndefined();
    });

    it("allows a partial update", () => {
        expect(ok(updateProductSchema, { price: "250" })).toEqual({ price: 250 });
    });

    // An image-only edit sends no body fields at all, and the schema cannot
    // see the uploaded file. Rejecting an empty object here would make
    // "change just the photo" impossible; the controller decides instead.
    it("accepts an empty object, because the photo may be the only change", () => {
        expect(ok(updateProductSchema, {})).toEqual({});
    });
});

describe("adjustStockSchema", () => {
    const key = { idempotencyKey: "abcdefgh1234" };

    it("accepts a negative order and a positive return", () => {
        expect(ok(adjustStockSchema, { delta: "-10", reason: "order", ...key }).delta).toBe(-10);
        expect(ok(adjustStockSchema, { delta: "5", reason: "return", ...key }).delta).toBe(5);
    });

    it("rejects a zero delta", () => {
        expect(fail(adjustStockSchema, { delta: "0", reason: "correction", ...key }).fields.delta[0])
            .toMatch(/cannot be zero/i);
    });

    it("enforces the sign each reason implies", () => {
        expect(fail(adjustStockSchema, { delta: "10", reason: "order", ...key }).fields.delta[0])
            .toMatch(/order must reduce stock/i);
        expect(fail(adjustStockSchema, { delta: "-5", reason: "return", ...key }).fields.delta[0])
            .toMatch(/must increase stock/i);
        expect(fail(adjustStockSchema, { delta: "-5", reason: "restock", ...key }).fields.delta[0])
            .toMatch(/must increase stock/i);
    });

    it("lets a correction go either way", () => {
        expect(ok(adjustStockSchema, { delta: "-5", reason: "correction", ...key }).delta).toBe(-5);
        expect(ok(adjustStockSchema, { delta: "5", reason: "correction", ...key }).delta).toBe(5);
    });

    it("rejects an unknown reason", () => {
        fail(adjustStockSchema, { delta: "-1", reason: "shrinkage", ...key }, "reason");
    });

    it("requires a usable idempotency key", () => {
        fail(adjustStockSchema, { delta: "-1", reason: "order" }, "idempotencyKey");
        fail(adjustStockSchema, { delta: "-1", reason: "order", idempotencyKey: "short" }, "idempotencyKey");
    });

    it("rejects a fractional delta", () => {
        expect(fail(adjustStockSchema, { delta: "-1.5", reason: "order", ...key }).fields.delta[0])
            .toMatch(/whole number/i);
    });
});

describe("auditQuerySchema", () => {
    it("defaults page and limit when absent", () => {
        expect(ok(auditQuerySchema, {})).toMatchObject({ page: 1, limit: 20 });
    });

    it("coerces query strings", () => {
        expect(ok(auditQuerySchema, { page: "3", limit: "50" })).toMatchObject({ page: 3, limit: 50 });
    });

    it("caps the limit so the ledger endpoint stays bounded", () => {
        fail(auditQuerySchema, { limit: "5000" }, "limit");
        fail(auditQuerySchema, { page: "0" }, "page");
    });
});
