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
app.get("/", (req, res) => {
    res.send("Prapatti Store Backend is running");
});
app.use("/api/auth", require("./src/routes/authRoutes"));
app.use("/api/company", require("./src/routes/companyRoutes"));
app.use("/api/order", require("./src/routes/orderRoutes"));
app.use("/api/return-order", require("./src/routes/returnOrderRoutes"));
app.use("/api/kraftmailer", require("./src/routes/kraftMailerRoutes"));
app.use("/api/taperoll", require("./src/routes/taprollRoutes"));

// serverless function for vercel(to avoid request if connection already established)
// Not want to use app.listen() because it will create a new connection for each request, if we are using serverless function.
let isConnected = false;

async function connectToDatabase() {
    if (isConnected) return;
    await dbConnect();
    isConnected = true;
}

// Connect to the database
app.use((req, res, next) => {
    if (!isConnected) {
        connectToDatabase();
    }
    next();
});

// Check if running in Vercel environment
if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    // For Vercel deployment, just export the app
    module.exports = app;
} else {
    // For local development, start the server
    const server = http.createServer(app);
    const PORT = process.env.PORT || 8000;
    
    server.listen(PORT, () => {
        console.log(`-------------------------------------`);
        console.log(`Listening on ${PORT}`);
        console.log(`-------------------------------------`);
    });
}
