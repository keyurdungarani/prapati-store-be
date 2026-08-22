"use strict";

// Express application, with NO side effects.
//
// This file builds and exports the app and nothing else. It does NOT connect
// to the database and it does NOT bind a port. That separation is what makes
// the app importable from a test:
//
//   server.js  ->  requires app.js, connects Mongo, listens        (production)
//   test/*.js  ->  requires app.js, points Mongoose at an in-memory
//                  replica set, never listens                      (tests)
//
// Anything with a side effect belongs in server.js, not here.

const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors({
    origin: true,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    exposedHeaders: ['Content-Disposition']
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// API Routes
app.get("/api", (req, res) => {
    res.send("Prapatti Store Backend is running");
});
app.use("/api/auth", require("./src/routes/authRoutes"));
app.use("/api/company", require("./src/routes/companyRoutes"));
app.use("/api/order", require("./src/routes/orderRoutes"));
app.use("/api/return-order", require("./src/routes/returnOrderRoutes"));
app.use("/api/kraftmailer", require("./src/routes/kraftMailerRoutes"));
app.use("/api/taperoll", require("./src/routes/taprollRoutes"));
app.use("/api/summary", require("./src/routes/summaryRoutes.js"));
app.use("/api/product", require("./src/routes/productRoutes"));

// Multipart upload errors (file too large, wrong mime type) arrive here as
// MulterError. Without this they collapse into a generic 500 that tells the
// user nothing about what they did wrong.
app.use(require("./src/middleware/uploadErrorHandler"));

module.exports = app;
