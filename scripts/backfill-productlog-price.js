"use strict";

// One-off backfill: give existing ledger entries a unitPrice.
//
// unitPrice was added after the first Product Stock entries were written, so
// those rows have no price and would contribute ₹0 to the movement chart.
// This copies each product's CURRENT price onto its historical entries.
//
// That is an approximation, and deliberately so: the true price at the time is
// not recoverable for rows written before the field existed. Every entry
// written from now on snapshots the real price. Run this once.
//
//   node scripts/backfill-productlog-price.js            (report only)
//   node scripts/backfill-productlog-price.js --apply    (write)

require("dotenv").config();
const mongoose = require("mongoose");
const { dbConnect } = require("../src/config/dbConnection");
const Product = require("../src/models/product");
const ProductLog = require("../src/models/productLog");

const APPLY = process.argv.includes("--apply");

(async () => {
    const conn = await dbConnect();
    if (!conn) {
        console.error("Could not connect to the database. Check MONGODB_URI.");
        process.exit(1);
    }

    try {
        // Rows with no usable price. A deleted product's entries cannot be
        // repriced, so they are reported and left alone.
        const stale = await ProductLog.find({
            $or: [{ unitPrice: { $exists: false } }, { unitPrice: 0 }],
        }).lean();

        if (stale.length === 0) {
            console.log("Nothing to backfill: every ledger entry already has a unitPrice.");
            return;
        }

        const productIds = [...new Set(stale.map((e) => String(e.product)))];
        const products = await Product.find({ _id: { $in: productIds } })
            .select("_id price")
            .lean();
        const priceById = new Map(products.map((p) => [String(p._id), p.price]));

        let updatable = 0;
        let orphaned = 0;
        const ops = [];

        for (const entry of stale) {
            const price = priceById.get(String(entry.product));
            if (price === undefined) {
                orphaned += 1;
                continue;
            }
            if (price === 0) continue; // genuinely a free item; nothing to do
            updatable += 1;
            ops.push({
                updateOne: {
                    filter: { _id: entry._id },
                    update: { $set: { unitPrice: price } },
                },
            });
        }

        console.log(`Ledger entries missing a price : ${stale.length}`);
        console.log(`Can be backfilled              : ${updatable}`);
        console.log(`Product deleted, left as is    : ${orphaned}`);

        if (!APPLY) {
            console.log("\nDry run. Re-run with --apply to write these changes.");
            return;
        }

        if (ops.length === 0) {
            console.log("\nNothing to write.");
            return;
        }

        const result = await ProductLog.bulkWrite(ops);
        console.log(`\nUpdated ${result.modifiedCount} entries.`);
    } catch (err) {
        console.error("Backfill failed:", err);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
})();
