import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
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
const controller = (await import("../src/controllers/product/productController.js")).default;

// Product Stock PDF report.
//
// Two layers are tested separately, because they fail for different reasons:
//
//   buildProductStockReportDocument   the NUMBERS -- totals, rows, labels.
//                                     Pure, so it is asserted directly rather
//                                     than by trying to read a binary.
//   POST /stock-report-pdf            the PLUMBING -- auth, scoping, and that
//                                     a real PDF actually comes back.

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

async function createProduct(name, price, totalStock) {
    const res = await request(app)
        .post("/api/product/add-product")
        .set(...auth(userId))
        .field("name", name)
        .field("price", String(price))
        .field("totalStock", String(totalStock))
        .attach("image", PNG, "pic.png");
    return res.body.data._id;
}

const download = () =>
    request(app)
        .post("/api/product/stock-report-pdf")
        .set(...auth(userId))
        .send({});

/** Flatten the document definition so text can be searched for. */
const asText = (doc) => JSON.stringify(doc);

/**
 * Pull the summary tiles out as { LABEL: value }.
 *
 * Asserting on this rather than on a loose regex over the whole document, so a
 * test cannot pass because the number it wants happens to appear somewhere
 * unrelated. Note reportLayout uppercases every card label.
 */
function summaryTiles(doc) {
    const block = doc.content.find(
        (node) =>
            node &&
            node.table &&
            Array.isArray(node.table.body) &&
            node.table.body.some((row) => row.some((cell) => cell && cell.stack))
    );
    if (!block) return {};

    const out = {};
    for (const row of block.table.body) {
        for (const cell of row) {
            if (cell && cell.stack) out[cell.stack[0].text] = cell.stack[1].text;
        }
    }
    return out;
}

describe("buildProductStockReportDocument", () => {
    const products = [
        { name: "ear buds", price: 100, currentStock: 15, updatedAt: new Date("2026-08-20") },
        { name: "power bank", price: 500, currentStock: 3, updatedAt: new Date("2026-08-21") },
        { name: "usb cable", price: 50, currentStock: 0, updatedAt: new Date("2026-08-22") },
    ];

    it("titles the report and stamps when it was taken", () => {
        const doc = controller.buildProductStockReportDocument(
            products,
            new Date("2026-08-23T09:30:00+05:30")
        );

        expect(doc.info.title).toBe("PRODUCT STOCK REPORT");
        // A snapshot, so it says "as on" rather than covering a date range.
        expect(asText(doc)).toMatch(/As on: 23-08-2026 09:30:00/);
    });

    it("totals units and value across every product", () => {
        const tiles = summaryTiles(controller.buildProductStockReportDocument(products));

        expect(tiles["TOTAL PRODUCTS"]).toBe("3");
        expect(tiles["UNITS IN STOCK"]).toBe("18");      // 15 + 3 + 0
        expect(tiles["STOCK VALUE"]).toBe("₹3000.00");   // 1500 + 1500 + 0
    });

    it("counts products that are out of stock", () => {
        const tiles = summaryTiles(controller.buildProductStockReportDocument(products));
        expect(tiles["OUT OF STOCK"]).toBe("1");         // usb cable

        const allStocked = products.filter((p) => p.currentStock > 0);
        const clean = summaryTiles(controller.buildProductStockReportDocument(allStocked));
        expect(clean["OUT OF STOCK"]).toBe("0");
    });

    it("lists every product with its own line total", () => {
        const text = asText(controller.buildProductStockReportDocument(products));

        expect(text).toMatch(/ear buds/);
        expect(text).toMatch(/power bank/);
        expect(text).toMatch(/usb cable/);

        expect(text).toMatch(/₹1500\.00/); // 15 x 100
        expect(text).toMatch(/₹1500\.00/); // 3 x 500
        expect(text).toMatch(/₹0\.00/);    // 0 x 50
    });

    it("says so plainly when there is no stock to report", () => {
        const doc = controller.buildProductStockReportDocument([]);
        expect(asText(doc)).toMatch(/No products in stock yet/);
    });

    it("does not blow up on a missing price or stock", () => {
        const doc = controller.buildProductStockReportDocument([
            { name: "broken row", price: undefined, currentStock: null, updatedAt: null },
        ]);
        expect(asText(doc)).toMatch(/broken row/);
        expect(asText(doc)).toMatch(/₹0\.00/);
    });
});

describe("POST /stock-report-pdf", () => {
    it("returns a real PDF as a download", async () => {
        await createProduct("ear buds", 100, 15);

        const res = await download().buffer().parse((r, cb) => {
            const chunks = [];
            r.on("data", (c) => chunks.push(c));
            r.on("end", () => cb(null, Buffer.concat(chunks)));
        });

        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toMatch(/application\/pdf/);
        expect(res.headers["content-disposition"]).toMatch(/attachment; filename=product-stock-report_/);

        // Magic bytes: proof it is a PDF, not a JSON error with a PDF header.
        expect(res.body.subarray(0, 5).toString()).toBe("%PDF-");
        expect(res.body.length).toBeGreaterThan(1000);
    });

    it("works with no products at all", async () => {
        const res = await download().buffer().parse((r, cb) => {
            const chunks = [];
            r.on("data", (c) => chunks.push(c));
            r.on("end", () => cb(null, Buffer.concat(chunks)));
        });

        expect(res.status).toBe(200);
        expect(res.body.subarray(0, 5).toString()).toBe("%PDF-");
    });

    it("requires a token", async () => {
        const res = await request(app).post("/api/product/stock-report-pdf").send({});
        expect(res.status).toBe(401);
    });

    // The report is built from the database, not from anything the client
    // sends, so it can only ever contain the caller's own stock.
    it("never includes another user's products", async () => {
        await createProduct("mine", 100, 5);

        const stranger = newUserId();
        const strangerProducts = await (await import("../src/models/product.js")).default
            .find({ user: stranger })
            .lean();

        expect(strangerProducts).toEqual([]);

        const doc = controller.buildProductStockReportDocument(strangerProducts);
        expect(asText(doc)).toMatch(/No products in stock yet/);
        expect(asText(doc)).not.toMatch(/mine/);
    });
});
