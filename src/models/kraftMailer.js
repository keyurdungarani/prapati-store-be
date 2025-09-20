const mongoose = require('mongoose');

const kraftMailerSchema = new mongoose.Schema({
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
    size: {
        width: { type: Number, required: true },
        height: { type: Number, required: true },
        depth: { type: Number },
    },
}, { timestamps: true });

module.exports = mongoose.model('KraftMailer', kraftMailerSchema);
