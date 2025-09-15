const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
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
