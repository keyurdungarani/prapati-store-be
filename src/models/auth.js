const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        required: true
    },
    mobile: {
        type: String,
        required: true
    },
    // Set to true manually in the database to grant access.
    isVerified: {
        type: Boolean,
        default: false
    },
    createdAt: Date,
    updatedAt: Date,
}, {
    timestamps: true
});


module.exports = mongoose.model("User", userSchema);
