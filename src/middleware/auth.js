const jwt = require("jsonwebtoken");
const User = require("../models/auth");

module.exports = async function (req, res, next) {
    try {
        // Check for Authorization header
        const authHeader = req.header("Authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ error: "Access denied. No token provided." });
        }

        const token = authHeader.replace("Bearer ", "");

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Tokens live for 80 days, so re-check approval on every request;
        // this also lets access be revoked by setting isVerified back to false.
        const user = await User.findById(decoded.userId).select("isVerified").lean();
        if (!user || user.isVerified !== true) {
            return res.status(403).json({ error: "Your account is not approved. Please contact the administrator." });
        }

        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: "Invalid or expired token." });
    }
};
