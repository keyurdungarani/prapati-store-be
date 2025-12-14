const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    name: {
        type: String,
        required: true,
    },
    platforms: [
        {
            type: String,
            required: true,
        },
    ],
}, { timestamps: true });

module.exports = mongoose.model('Company', companySchema);
