const jwt = require("jsonwebtoken");

module.exports = function (req, res, next) {
    try {
        // Check for Authorization header
        const authHeader = req.header("Authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ error: "Access denied. No token provided." });
        }

        const token = authHeader.replace("Bearer ", "");

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: "Invalid or expired token." });
    }
};
