const mongoose = require('mongoose');

const kraftMailerSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
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
