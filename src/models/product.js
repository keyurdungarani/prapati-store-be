const mongoose = require('mongoose');

// A product you hold stock of.
//
//   ONE stock number is stored: currentStock. There is no separate "total"
//   field, because two mutable stock numbers drift and nothing defines which
//   one a "+5" should move.
//
//   INVARIANT
//     product.currentStock === SUM(ProductLog.delta WHERE log.product === _id)
//
//   Creation writes an opening log entry of +currentStock, so the sum holds
//   from the first moment. currentStock is therefore a maintained cache of the
//   ledger, and any disagreement between the two is detectable (see TODOS.md,
//   "Stock invariant reconciliation").
//
//   currentStock is written ONLY by adjustStock, inside a transaction, via a
//   guarded $inc. updateProduct whitelists name/price/image and can never
//   touch it -- otherwise the edit endpoint would bypass the ledger.
//
//   totalPrice is NOT stored. It is currentStock * price, computed on read, so
//   it cannot go stale after an adjustment.

const productSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    name: {
        type: String,
        required: true,
        trim: true,
    },
    image: {
        // secure_url, shown in the UI.
        url: { type: String, required: true },
        // The ONLY handle that can delete the asset from Cloudinary later.
        // Storing just the url is a one-way door: every deleted product and
        // every replaced photo would leak storage with no way to clean up.
        publicId: { type: String, required: true },
    },
    price: {
        type: Number,
        required: true,
        min: 0,
    },
    currentStock: {
        type: Number,
        required: true,
        min: 0,
        default: 0,
    },
}, { timestamps: true });

// Every query is scoped by user; most also sort by name.
productSchema.index({ user: 1, name: 1 });

// Registered once. Guarded because a module can be evaluated more than once
// in the same process (vitest loads app.js as CJS and the models as ESM), and
// mongoose.model() throws OverwriteModelError on the second call.
module.exports = mongoose.models.Product || mongoose.model('Product', productSchema);
