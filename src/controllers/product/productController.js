"use strict";

const mongoose = require("mongoose");
const { Types } = mongoose;

const Product = require("../../models/product");
const ProductLog = require("../../models/productLog");
// Called through the module object rather than destructured. Destructuring
// would capture the function values at require time, which makes the image
// backend impossible to substitute in a test without a production-only seam.
const imageStore = require("../../config/cloudinary");
const {
    dayRange,
    seriesRange,
    bucketsBetween,
    bucketFormat,
    timezone,
} = require("../../config/businessTime");
const {
    createProductSchema,
    updateProductSchema,
    adjustStockSchema,
    auditQuerySchema,
    summaryQuerySchema,
    seriesQuerySchema,
    validate,
} = require("../../validation/productSchema");

// Product Stock: inventory with an append-only ledger.
//
//   WRITE PATH FOR A STOCK ADJUSTMENT
//
//     POST /adjust-stock/:id { delta: -10, reason: 'order', idempotencyKey }
//                 |
//        [ authUser -> req.user.userId ]
//                 |
//        [ zod: whole non-zero delta, reason/sign agree ]
//                 |
//        [ idempotency fast path: key already used? -> return that result ]
//                 |
//     +--- withTransaction ------------------------------------+
//     |  findOneAndUpdate(                                      |
//     |    { _id, user, currentStock: { $gte: 10 } },  <- guard |
//     |    { $inc: { currentStock: -10 } })                     |
//     |        null? -> throw AdjustRejected -> abort           |
//     |  ProductLog.create([entry], { session })                |
//     |        duplicate key? -> abort (concurrent retry)       |
//     +--- commit or roll back, never half ---------------------+
//                 |
//        stock and ledger moved together, or neither did
//
//   Three separate things make this safe, and all three are needed:
//     $inc            an absolute $set would lose a concurrent update
//     $gte guard      an application-level check cannot prevent an oversell
//     transaction     without it a failed log insert leaves stock with no history
//     idempotencyKey  a transaction makes ONE request atomic; it does nothing
//                     about the same request arriving twice

/** Sentinel for "the guarded update matched nothing", disambiguated after abort. */
class AdjustRejected extends Error {
    constructor() {
        super("Adjustment rejected by guard");
        this.name = "AdjustRejected";
    }
}

const isDuplicateKey = (err) =>
    err && (err.code === 11000 || err.code === 11001);

/** Parse an id, or null when it is not a valid ObjectId. */
const parseId = (id) => (Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null);

/**
 * API shape for a product. `totalPrice` is derived here and never stored, so
 * it cannot go stale after an adjustment.
 */
const toProduct = (doc) => ({
    _id: doc._id,
    name: doc.name,
    image: doc.image,
    price: doc.price,
    currentStock: doc.currentStock,
    totalPrice: doc.currentStock * doc.price,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
});

const badRequest = (res, message, fields) =>
    res.status(400).json({ statusCode: 400, message, ...(fields && { fields }) });

const notFound = (res) =>
    res.status(404).json({ statusCode: 404, message: "Product not found" });

const serverError = (res) =>
    res.status(500).json({ statusCode: 500, message: "Internal Server Error" });

/**
 * Answer a failed Cloudinary upload.
 *
 * Our own multer cap is deliberately generous, so Cloudinary's account limit
 * can now be the stricter of the two. When it rejects a file it says exactly
 * why ("File size too large. Got X. Maximum is Y.") and that message is far
 * more useful than a blanket 500 -- it names the real ceiling, which is the
 * one thing the user needs in order to act.
 *
 * Anything that is not a client-side problem stays a 500.
 */
const uploadFailed = (res, err) => {
    console.error("Cloudinary upload failed:", err);

    if (err && err.http_code === 400 && err.message) {
        const tooLarge = /file size too large/i.test(err.message);
        return res.status(tooLarge ? 413 : 400).json({
            statusCode: tooLarge ? 413 : 400,
            message: err.message,
        });
    }

    return serverError(res);
};

module.exports = {
    // ---------------------------------------------------------------- create
    addProduct: async (req, res) => {
        try {
            const parsed = validate(createProductSchema, req.body);
            if (!parsed.ok) return badRequest(res, parsed.message, parsed.fields);

            if (!req.file || !req.file.buffer) {
                return badRequest(res, "Product image is required", {
                    image: ["Product image is required"],
                });
            }

            const { name, price, totalStock } = parsed.data;

            // Upload first: if Cloudinary fails there is nothing to roll back.
            // The reverse order would risk a product row with no image.
            let image;
            try {
                image = await imageStore.uploadImage(req.file.buffer);
            } catch (err) {
                return uploadFailed(res, err);
            }

            const session = await mongoose.startSession();
            let created;
            try {
                await session.withTransaction(async () => {
                    const docs = await Product.create(
                        [{
                            user: req.user.userId,
                            name,
                            price,
                            currentStock: totalStock,
                            image,
                        }],
                        { session }
                    );
                    created = docs[0];

                    // Opening entry, so SUM(delta) === currentStock from the
                    // very first moment and the invariant holds with no
                    // special case for "the initial value".
                    await ProductLog.create(
                        [{
                            user: req.user.userId,
                            product: created._id,
                            productName: created.name,
                            action: "create",
                            reason: "opening",
                            delta: totalStock,
                            unitPrice: price,
                            stockBefore: 0,
                            stockAfter: totalStock,
                            changes: [
                                { field: "name", from: null, to: name },
                                { field: "price", from: null, to: price },
                                { field: "currentStock", from: null, to: totalStock },
                            ],
                            at: new Date(),
                        }],
                        { session }
                    );
                });
            } catch (err) {
                // The product never landed, so the just-uploaded image is an
                // orphan. Clean it up; failure to do so is logged, not fatal.
                await imageStore.destroyImage(image.publicId);
                console.error("addProduct transaction failed:", err);
                return serverError(res);
            } finally {
                await session.endSession();
            }

            return res.status(201).json({
                statusCode: 201,
                message: "Product added successfully",
                data: toProduct(created),
            });
        } catch (err) {
            console.error(err);
            return serverError(res);
        }
    },

    // ------------------------------------------------------------------ list
    listProducts: async (req, res) => {
        try {
            const products = await Product.find({ user: req.user.userId })
                .sort({ name: 1 })
                .lean();

            return res.status(200).json({
                statusCode: 200,
                message: "Products retrieved successfully",
                data: products.map(toProduct),
            });
        } catch (err) {
            console.error(err);
            return serverError(res);
        }
    },

    // ---------------------------------------------------------------- update
    updateProduct: async (req, res) => {
        try {
            const _id = parseId(req.params.id);
            if (!_id) return notFound(res);

            const parsed = validate(updateProductSchema, req.body);
            if (!parsed.ok) return badRequest(res, parsed.message, parsed.fields);

            const before = await Product.findOne({ _id, user: req.user.userId });
            if (!before) return notFound(res);

            // WHITELIST. Only these fields can ever be written here.
            //
            // currentStock is deliberately absent: it moves only through
            // adjustStock, which records a ledger entry in the same
            // transaction. Letting an edit write it would break the invariant
            // with no audit trail, which is the one thing this design exists
            // to prevent.
            const updates = {};
            const changes = [];
            if (parsed.data.name !== undefined && parsed.data.name !== before.name) {
                updates.name = parsed.data.name;
                changes.push({ field: "name", from: before.name, to: parsed.data.name });
            }
            if (parsed.data.price !== undefined && parsed.data.price !== before.price) {
                updates.price = parsed.data.price;
                changes.push({ field: "price", from: before.price, to: parsed.data.price });
            }

            // Optional photo replacement.
            let newImage = null;
            const oldPublicId = before.image ? before.image.publicId : null;
            if (req.file && req.file.buffer) {
                try {
                    newImage = await imageStore.uploadImage(req.file.buffer);
                } catch (err) {
                    return uploadFailed(res, err);
                }
                updates.image = newImage;
                changes.push({
                    field: "image",
                    from: before.image ? before.image.url : null,
                    to: newImage.url,
                });
            }

            if (changes.length === 0) {
                return res.status(200).json({
                    statusCode: 200,
                    message: "Nothing changed",
                    data: toProduct(before),
                });
            }

            const session = await mongoose.startSession();
            let updated;
            try {
                await session.withTransaction(async () => {
                    updated = await Product.findOneAndUpdate(
                        { _id, user: req.user.userId },
                        { $set: updates },
                        { new: true, runValidators: true, session }
                    );
                    if (!updated) throw new AdjustRejected();

                    await ProductLog.create(
                        [{
                            user: req.user.userId,
                            product: _id,
                            productName: updated.name,
                            action: "update",
                            reason: "edit",
                            delta: 0,
                            unitPrice: updated.price,
                            stockBefore: before.currentStock,
                            stockAfter: before.currentStock,
                            changes,
                            at: new Date(),
                        }],
                        { session }
                    );
                });
            } catch (err) {
                if (newImage) await imageStore.destroyImage(newImage.publicId);
                if (err instanceof AdjustRejected) return notFound(res);
                console.error("updateProduct transaction failed:", err);
                return serverError(res);
            } finally {
                await session.endSession();
            }

            // AFTER the commit, never before. A destroy that runs first would
            // leave a live product pointing at a deleted image if the write
            // then failed. An orphan is the cheaper of the two failures.
            if (newImage && oldPublicId) await imageStore.destroyImage(oldPublicId);

            return res.status(200).json({
                statusCode: 200,
                message: "Product updated successfully",
                data: toProduct(updated),
            });
        } catch (err) {
            console.error(err);
            return serverError(res);
        }
    },

    // ---------------------------------------------------------------- delete
    deleteProduct: async (req, res) => {
        try {
            const _id = parseId(req.params.id);
            if (!_id) return notFound(res);

            const before = await Product.findOne({ _id, user: req.user.userId });
            if (!before) return notFound(res);

            const session = await mongoose.startSession();
            try {
                await session.withTransaction(async () => {
                    const removed = await Product.findOneAndDelete(
                        { _id, user: req.user.userId },
                        { session }
                    );
                    if (!removed) throw new AdjustRejected();

                    // The ledger outlives the product. productName is already
                    // snapshotted on every entry, so this product's whole
                    // history stays readable after the row is gone.
                    await ProductLog.create(
                        [{
                            user: req.user.userId,
                            product: _id,
                            productName: before.name,
                            action: "delete",
                            reason: "deleted",
                            delta: -before.currentStock,
                            unitPrice: before.price,
                            stockBefore: before.currentStock,
                            stockAfter: 0,
                            changes: [
                                { field: "name", from: before.name, to: null },
                                { field: "price", from: before.price, to: null },
                                { field: "currentStock", from: before.currentStock, to: null },
                            ],
                            at: new Date(),
                        }],
                        { session }
                    );
                });
            } catch (err) {
                if (err instanceof AdjustRejected) return notFound(res);
                console.error("deleteProduct transaction failed:", err);
                return serverError(res);
            } finally {
                await session.endSession();
            }

            if (before.image) await imageStore.destroyImage(before.image.publicId);

            return res.status(200).json({
                statusCode: 200,
                message: "Product deleted successfully",
            });
        } catch (err) {
            console.error(err);
            return serverError(res);
        }
    },

    // ---------------------------------------------------------- adjust stock
    adjustStock: async (req, res) => {
        try {
            const _id = parseId(req.params.id);
            if (!_id) return notFound(res);

            const parsed = validate(adjustStockSchema, req.body);
            if (!parsed.ok) return badRequest(res, parsed.message, parsed.fields);

            const { delta, reason, note, idempotencyKey } = parsed.data;

            // Fast path for the common retry: this key already did its work,
            // so report the original outcome instead of applying it again.
            const seen = await ProductLog.findOne({
                idempotencyKey,
                user: req.user.userId,
            }).lean();
            if (seen) {
                return res.status(200).json({
                    statusCode: 200,
                    message: "Stock already updated",
                    data: { currentStock: seen.stockAfter, duplicate: true },
                });
            }

            const session = await mongoose.startSession();
            let updated;
            try {
                await session.withTransaction(async () => {
                    // The guard lives INSIDE the query, so the check and the
                    // decrement are one atomic operation. Checking in JS first
                    // would leave a window where two requests both pass.
                    const guard = { _id, user: req.user.userId };
                    if (delta < 0) guard.currentStock = { $gte: -delta };

                    updated = await Product.findOneAndUpdate(
                        guard,
                        { $inc: { currentStock: delta } },
                        { new: true, session }
                    );
                    // Could be: no such product, not yours, or not enough
                    // stock. Which one is worked out after the abort.
                    if (!updated) throw new AdjustRejected();

                    await ProductLog.create(
                        [{
                            user: req.user.userId,
                            product: _id,
                            productName: updated.name,
                            action: "adjust",
                            reason,
                            delta,
                            // Price as it stands right now. A later price
                            // change must not restate what this day was worth.
                            unitPrice: updated.price,
                            stockBefore: updated.currentStock - delta,
                            stockAfter: updated.currentStock,
                            ...(note && { note }),
                            idempotencyKey,
                            at: new Date(),
                        }],
                        { session }
                    );
                });
            } catch (err) {
                await session.endSession();

                // Lost the race to a concurrent retry with the same key. The
                // other request committed, so report its result.
                if (isDuplicateKey(err)) {
                    const winner = await ProductLog.findOne({
                        idempotencyKey,
                        user: req.user.userId,
                    }).lean();
                    if (winner) {
                        return res.status(200).json({
                            statusCode: 200,
                            message: "Stock already updated",
                            data: { currentStock: winner.stockAfter, duplicate: true },
                        });
                    }
                }

                if (err instanceof AdjustRejected) {
                    // Now disambiguate. A null from the guarded update does
                    // NOT mean overdraw on its own -- it also covers an
                    // unknown id and another user's product.
                    const exists = await Product.findOne({
                        _id,
                        user: req.user.userId,
                    }).lean();
                    if (!exists) return notFound(res);

                    return badRequest(
                        res,
                        `Only ${exists.currentStock} in stock, cannot remove ${Math.abs(delta)}`,
                        { delta: [`Only ${exists.currentStock} in stock`] }
                    );
                }

                console.error("adjustStock transaction failed:", err);
                return serverError(res);
            }

            await session.endSession();

            return res.status(200).json({
                statusCode: 200,
                message: "Stock updated successfully",
                data: toProduct(updated),
            });
        } catch (err) {
            console.error(err);
            return serverError(res);
        }
    },

    // --------------------------------------------------------- audit history
    getAuditHistory: async (req, res) => {
        try {
            const parsed = validate(auditQuerySchema, req.query);
            if (!parsed.ok) return badRequest(res, parsed.message, parsed.fields);

            const { page, limit, productId } = parsed.data;

            const filter = { user: req.user.userId };
            if (productId) {
                const pid = parseId(productId);
                if (!pid) return badRequest(res, "Invalid productId");
                filter.product = pid;
            }

            // Bounded by design. An unpaginated ledger is the first thing that
            // would fall over after a year of daily adjustments.
            const [total, items] = await Promise.all([
                ProductLog.countDocuments(filter),
                ProductLog.find(filter)
                    .sort({ at: -1 })
                    .skip((page - 1) * limit)
                    .limit(limit)
                    .lean(),
            ]);

            return res.status(200).json({
                statusCode: 200,
                message: "Audit history retrieved successfully",
                data: {
                    items,
                    total,
                    page,
                    limit,
                    totalPages: Math.max(1, Math.ceil(total / limit)),
                },
            });
        } catch (err) {
            console.error(err);
            return serverError(res);
        }
    },

    // --------------------------------------------------------- stock summary
    getStockSummary: async (req, res) => {
        try {
            const parsed = validate(summaryQuerySchema, req.query);
            if (!parsed.ok) return badRequest(res, parsed.message, parsed.fields);

            // Business-day boundaries come from APP_TIMEZONE, not from the
            // server's clock and not from the caller. One definition of "a
            // day", shared with anything added later.
            const { start, end } = dayRange(parsed.data);

            // new Types.ObjectId is REQUIRED here.
            //
            // aggregate() bypasses Mongoose casting, so a plain string user id
            // matches nothing -- and $match matching nothing is not an error,
            // it is an empty result. The graph would render zeros forever with
            // nothing to indicate a bug. Same reason summaryController.js:16
            // does this.
            const match = {
                user: new Types.ObjectId(req.user.userId),
                action: "adjust",
                at: { $gte: start, $lte: end },
            };

            const [result] = await ProductLog.aggregate([
                { $match: match },
                {
                    $facet: {
                        totals: [
                            {
                                $group: {
                                    _id: null,
                                    plus: {
                                        $sum: { $cond: [{ $gt: ["$delta", 0] }, "$delta", 0] },
                                    },
                                    minus: {
                                        $sum: {
                                            $cond: [{ $lt: ["$delta", 0] }, { $abs: "$delta" }, 0],
                                        },
                                    },
                                    movements: { $sum: 1 },
                                },
                            },
                        ],
                        byReason: [
                            {
                                $group: {
                                    _id: "$reason",
                                    total: { $sum: { $abs: "$delta" } },
                                    movements: { $sum: 1 },
                                },
                            },
                            { $sort: { _id: 1 } },
                        ],
                    },
                },
            ]);

            const totals = (result && result.totals[0]) || {
                plus: 0,
                minus: 0,
                movements: 0,
            };

            return res.status(200).json({
                statusCode: 200,
                message: "Stock summary retrieved successfully",
                data: {
                    from: start,
                    to: end,
                    plus: totals.plus,
                    minus: totals.minus,
                    net: totals.plus - totals.minus,
                    movements: totals.movements,
                    byReason: ((result && result.byReason) || []).map((r) => ({
                        reason: r._id,
                        total: r.total,
                        movements: r.movements,
                    })),
                },
            });
        } catch (err) {
            console.error(err);
            return serverError(res);
        }
    },
    // ---------------------------------------------------------- movement series
    //
    // Daily or monthly stock movement for a chart: how many units moved, and
    // how much that was worth.
    //
    //   ledger entries          $group by day/month        padded buckets
    //   (action: 'adjust')  ->  in APP_TIMEZONE        ->  every day present,
    //                           plus / minus / value       zeros included
    //
    // Grouping happens in the database, not the browser, for the same reason
    // the today-summary does: the audit list is paginated, so summing whatever
    // page is loaded would chart a fraction of the data and look plausible.
    //
    // Value uses the unitPrice SNAPSHOTTED on each entry, so changing a
    // product's price today does not rewrite what last month was worth.
    //
    // Only `adjust` entries count. Creating a product is data entry, not a
    // day's stock movement -- otherwise adding a 500-unit product would show
    // up as a 500-unit spike.
    getStockSeries: async (req, res) => {
        try {
            const parsed = validate(seriesQuerySchema, req.query);
            if (!parsed.ok) return badRequest(res, parsed.message, parsed.fields);

            const { period } = parsed.data;
            const { start, end } = seriesRange(parsed.data);
            const tz = timezone();

            const rows = await ProductLog.aggregate([
                {
                    $match: {
                        // Cast required: aggregate() bypasses Mongoose casting,
                        // and an uncast string silently matches nothing.
                        user: new Types.ObjectId(req.user.userId),
                        action: "adjust",
                        at: { $gte: start, $lte: end },
                    },
                },
                {
                    $addFields: {
                        // |delta| * price, with a fallback for entries written
                        // before unitPrice existed.
                        movementValue: {
                            $multiply: [
                                { $abs: "$delta" },
                                { $ifNull: ["$unitPrice", 0] },
                            ],
                        },
                    },
                },
                {
                    $group: {
                        _id: {
                            $dateToString: {
                                format: bucketFormat(period),
                                date: "$at",
                                timezone: tz,
                            },
                        },
                        plus: { $sum: { $cond: [{ $gt: ["$delta", 0] }, "$delta", 0] } },
                        minus: {
                            $sum: { $cond: [{ $lt: ["$delta", 0] }, { $abs: "$delta" }, 0] },
                        },
                        plusValue: {
                            $sum: { $cond: [{ $gt: ["$delta", 0] }, "$movementValue", 0] },
                        },
                        minusValue: {
                            $sum: { $cond: [{ $lt: ["$delta", 0] }, "$movementValue", 0] },
                        },
                        movements: { $sum: 1 },
                    },
                },
            ]);

            const byKey = new Map(rows.map((r) => [r._id, r]));

            // Pad every bucket in the window. A day with no movement must show
            // as a zero on the axis, not vanish and make the chart misleading.
            const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

            const buckets = bucketsBetween(start, end, period).map(({ key, label }) => {
                const r = byKey.get(key) || {};
                const plus = r.plus || 0;
                const minus = r.minus || 0;
                const plusValue = round2(r.plusValue || 0);
                const minusValue = round2(r.minusValue || 0);
                return {
                    key,
                    label,
                    plus,
                    minus,
                    net: plus - minus,
                    plusValue,
                    minusValue,
                    totalValue: round2(plusValue + minusValue),
                    netValue: round2(plusValue - minusValue),
                    movements: r.movements || 0,
                };
            });

            const sum = (field) => buckets.reduce((acc, b) => acc + b[field], 0);
            const totals = {
                plus: sum("plus"),
                minus: sum("minus"),
                net: sum("plus") - sum("minus"),
                plusValue: round2(sum("plusValue")),
                minusValue: round2(sum("minusValue")),
                totalValue: round2(sum("plusValue") + sum("minusValue")),
                netValue: round2(sum("plusValue") - sum("minusValue")),
                movements: sum("movements"),
            };

            return res.status(200).json({
                statusCode: 200,
                message: "Stock movement series retrieved successfully",
                data: { period, timezone: tz, from: start, to: end, buckets, totals },
            });
        } catch (err) {
            console.error(err);
            return serverError(res);
        }
    },
};
