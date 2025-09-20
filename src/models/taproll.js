const mongoose = require('mongoose');

const taprollSchema = new mongoose.Schema({
    date: {
        type: Date,
        required: true
    },
    quantity: {
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
    platform: {
        type: String,
        enum: ['Amazon Taproll', 'Flipkart Taproll', 'Meesho Taproll'],
        required: true
    }
}, { timestamps: true });

module.exports = mongoose.model('Taproll', taprollSchema);