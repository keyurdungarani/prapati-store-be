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
app.use("/api/auth", require("./src/routes/authRoutes"));
app.use("/api/company", require("./src/routes/companyRoutes"));
app.use("/api/order", require("./src/routes/orderRoutes"));
app.use("/api/return-order", require("./src/routes/returnOrderRoutes"));

// Connect to the database
dbConnect();

const server = http.createServer(app);

server.listen(process.env.PORT, () => {
    console.log(`-------------------------------------`);
    console.log(`Listening on ${process.env.PORT}`);
    console.log(`-------------------------------------`);
});

module.exports = app;
