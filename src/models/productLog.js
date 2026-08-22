const mongoose = require('mongoose');

// Append-only ledger of everything that ever happened to a product.
//
// ONE collection serves three features, so there is only one source of truth:
//
//                        ProductLog entry
//                              |
//        +---------------------+---------------------+
//        |                     |                     |
//        v                     v                     v
//   AUDIT HISTORY         TODAY'S GRAPH        STOCK INVARIANT
//   list, paginated,      $group over the      SUM(delta) must equal
//   before -> after       business day,        product.currentStock
//                         split by sign
//
// Entries are NEVER updated or deleted. A mistake is corrected by appending a
// new entry with reason 'correction', which is why the history can be trusted.
//
//   ACTION / DELTA / REASON
//     create  delta = +opening stock   reason 'opening'
//     adjust  delta = signed, non-zero reason order|return|restock|correction
//     update  delta = 0                name/price/image edit, see `changes`
//     delete  delta = -currentStock    reason 'deleted'
//
//   SIGN RULES (enforced in validation/productSchema.js)
//     order      -> must be negative   (stock leaving)
//     return     -> must be positive   (stock coming back)
//     restock    -> must be positive   (stock bought in)
//     correction -> either sign        (fixing a mistake)

const auditChangeSchema = new mongoose.Schema({
    field: { type: String, required: true },
    from: { type: mongoose.Schema.Types.Mixed, default: null },
    to: { type: mongoose.Schema.Types.Mixed, default: null },
}, { _id: false });

const productLogSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true,
    },
    // Snapshotted deliberately, NOT populated on read.
    //
    // A populate() returns null once the product is deleted, which would blank
    // out that product's entire history -- including the delete entry itself,
    // the one you would actually go looking for. A name frozen at write time
    // also correctly shows what the product was called back then.
    productName: {
        type: String,
        required: true,
    },
    action: {
        type: String,
        required: true,
        enum: ['create', 'adjust', 'update', 'delete'],
    },
    reason: {
        type: String,
        required: true,
        enum: ['opening', 'order', 'return', 'restock', 'correction', 'edit', 'deleted'],
    },
    // Signed. Negative removes stock, positive adds it.
    delta: {
        type: Number,
        required: true,
        default: 0,
    },
    // The product's price at the moment this entry was written.
    //
    // Snapshotted for the same reason as productName: the movement CHART
    // reports how much value moved on a given day, and joining to the
    // product's current price would restate history every time you change a
    // price, and show nothing at all for a deleted product.
    //
    //   value of this movement = |delta| * unitPrice
    unitPrice: {
        type: Number,
        default: 0,
        min: 0,
    },
    // Persisted, not reconstructed. Recomputing "what was it before" by
    // replaying the log is only correct if nothing else ever wrote the number;
    // storing both ends makes each entry independently readable.
    stockBefore: {
        type: Number,
        required: true,
    },
    stockAfter: {
        type: Number,
        required: true,
    },
    // Field-level before/after for name/price/image edits.
    changes: {
        type: [auditChangeSchema],
        default: [],
    },
    // Optional free-text note the user attaches to an adjustment.
    note: {
        type: String,
        trim: true,
        maxlength: 200,
    },
    // Supplied by the browser, one per button press and reused on retry.
    //
    // The unique index is what actually prevents a double-apply: a transaction
    // makes ONE adjustment atomic, but two requests are two perfectly valid
    // transactions. Sparse, because only 'adjust' entries carry a key.
    idempotencyKey: {
        type: String,
        default: undefined,
    },
    // Explicit, NOT mongoose timestamps.
    //
    // { timestamps: true } would create `createdAt`, and every index and
    // $match here targets `at`. A $match on a field that does not exist
    // matches nothing and returns zeros with no error.
    at: {
        type: Date,
        required: true,
        default: Date.now,
    },
}, { timestamps: true });

// Two different access patterns, two different indexes.
//   audit history / today's summary : filter by user, sort by time
//   one product's history           : filter by user + product, sort by time
productLogSchema.index({ user: 1, at: -1 });
productLogSchema.index({ user: 1, product: 1, at: -1 });
productLogSchema.index(
    { idempotencyKey: 1 },
    { unique: true, sparse: true }
);

// Registered once. See the note in product.js: a module can be evaluated more
// than once in the same process, and mongoose.model() throws on the second call.
module.exports = mongoose.models.ProductLog || mongoose.model('ProductLog', productLogSchema);
