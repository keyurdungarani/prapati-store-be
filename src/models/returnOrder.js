const mongoose = require('mongoose');

const returnOrderSchema = new mongoose.Schema({
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
    returnReason: {
        type: String,
        required: true,
        enum: ['Damaged', 'OK', 'Different']
    },
    returnBy: {
        type: String,
        required: true,
        enum: ['RTO', 'Customer']
    },
}, { timestamps: true });

module.exports = mongoose.model('ReturnOrder', returnOrderSchema);
