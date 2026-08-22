"use strict";

// Bootstrap: config checks, database connection, port binding.
//
// The app itself lives in ./app.js and has no side effects, so tests can
// require it without touching Atlas or grabbing a port.

const http = require("http");
require("dotenv").config();

const app = require("./app");
const { dbConnect } = require("./src/config/dbConnection");
const { assertValidTimezone } = require("./src/config/businessTime");

// Fail fast on a bad APP_TIMEZONE.
//
// The stock summary groups movements into business days using this zone. If it
// is unset or misspelled there is no error at request time -- the graph just
// reports the wrong 24 hours, and looks completely plausible while doing it.
// A config error should stop the process, not quietly produce wrong numbers.
assertValidTimezone();

dbConnect();

const server = http.createServer(app);
const PORT = process.env.PORT || 8000;

server.listen(PORT, () => {
    console.log(`-------------------------------------`);
    console.log(`Listening on ${PORT}`);
    console.log(`-------------------------------------`);
});

module.exports = server;
