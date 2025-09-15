const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    date: {
        type: Date,
        required: true
    },
    product: {
        type: String,
        required: true
    },
    qty: {
        type: Number,
        required: true
    },
    price: {
        type: Number,
        required: true
    },
    totalPrice: {
        type: Number,
        required: true
    },
    company: {
        type: String,
        required: true
    },
    platforms: [
        {
            type: String,
            required: true,
        },
    ],
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);
