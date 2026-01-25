"use strict";

const express = require("express");
const cors = require("cors");
const http = require("http");
require("dotenv").config();
const { dbConnect } = require("./src/config/dbConnection");
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

dbConnect();

const server = http.createServer(app);
const PORT = process.env.PORT || 8000;

    server.listen(PORT, () => {
        console.log(`-------------------------------------`);
        console.log(`Listening on ${PORT}`);
        console.log(`-------------------------------------`);
    });
    
module.exports = app;