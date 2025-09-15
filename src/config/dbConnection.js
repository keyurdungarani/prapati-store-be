"use strict";

const mongoose = require("mongoose");
require("dotenv").config();

// Connect to the MongoDB database using Mongoose
const dbConnect = async () => {
  try {
    const connection = await mongoose.connect(process.env.MONGODB_URI);
    if (connection) {
      console.log("Database connected successfully");
    }
    return connection;
  } catch (error) {
    console.log("Database connection error", error);
    return null;
  }
};

module.exports = {
  dbConnect
};
