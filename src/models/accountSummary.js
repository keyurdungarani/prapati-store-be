const mongoose = require('mongoose');

const accountSummarySchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    fromDate: {
        type: Date,
        required: true
    },
    toDate: {
        type: Date,
        required: true
    },
    orders: {
        type: Number,
        required: true,
        default: 0
    },
    returnOrders: {
        type: Number,
        required: true,
        default: 0
    },
    kraftMailers: {
        type: Number,
        required: true,
        default: 0
    },
    taprolls: {
        type: Number,
        required: true,
        default: 0
    },
    officeExpenses: {
        type: Number,
        required: true,
        default: 0
    },
    totalReceivedPayment: {
        type: Number,
        required: true,
        default: 0
    },
    netIncome: {
        type: Number,
        required: true,
        default: 0
    },
}, { timestamps: true });

module.exports = mongoose.model('AccountSummary', accountSummarySchema);
