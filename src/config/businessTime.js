"use strict";

const moment = require("moment-timezone");

// The shop's business day.
//
// One definition, used by the stock summary and by anything added later that
// needs a date range (reports, exports). Keeping it here means the graph and a
// future report can never disagree about when a day starts.
//
//   APP_TIMEZONE=Asia/Kolkata
//
//        UTC:  ....18:30 Mon | 19:00      ....      18:29 Tue | 18:30 Tue....
//        IST:  ....00:00 Tue | 00:30      ....      23:59 Tue | 00:00 Wed....
//                  |<-------------- one business day ------->|
//
//   A movement made at 01:00 IST belongs to the day that just started, even
//   though in UTC it is still the previous date. Computing this with the
//   server's own clock is what puts early-morning work on the wrong bar.

const DEFAULT_TIMEZONE = "Asia/Kolkata";

/** The configured zone, falling back to the shop's home zone. */
function timezone() {
    return process.env.APP_TIMEZONE || DEFAULT_TIMEZONE;
}

/**
 * True when `name` is a zone moment-timezone actually has data for.
 * moment.tz.zone() returns null for unknown names rather than throwing, which
 * is exactly why an unvalidated typo is silent.
 */
function isValidTimezone(name) {
    return Boolean(name) && moment.tz.zone(name) !== null;
}

/**
 * Called once at boot. Exits the process on a bad zone rather than letting the
 * app serve wrong-day numbers. Throws instead of exiting when the caller asks,
 * so tests can assert on it.
 */
function assertValidTimezone({ exit = true } = {}) {
    const name = timezone();
    if (isValidTimezone(name)) return name;

    const message =
        `FATAL: APP_TIMEZONE "${name}" is not a known timezone. ` +
        `Set it to a valid IANA zone (for example Asia/Kolkata) in .env. ` +
        `Refusing to start, because an invalid zone silently produces ` +
        `stock summaries for the wrong day.`;

    if (!exit) throw new Error(message);
    console.error(message);
    process.exit(1);
}

/**
 * Absolute UTC instants bounding a business day.
 *
 * `from`/`to` are optional ISO strings. When absent, "today" in the configured
 * zone is used. Callers pass a range for historical lookups; the graph passes
 * nothing and gets today.
 */
function dayRange({ from, to } = {}) {
    const tz = timezone();
    const start = from
        ? moment.tz(from, tz).startOf("day")
        : moment.tz(tz).startOf("day");
    const end = to
        ? moment.tz(to, tz).endOf("day")
        : moment.tz(tz).endOf("day");

    return { start: start.toDate(), end: end.toDate() };
}

// ---------------------------------------------------------------- bucketing
//
// The movement chart groups the ledger into days or months. Both the grouping
// key and the list of buckets to display are produced here, in the configured
// zone, so a movement at 01:00 IST lands on the right bar and an empty day
// still appears on the axis instead of silently collapsing.

const PERIODS = ["daily", "monthly"];

const BUCKET_FORMAT = {
    daily: "%Y-%m-%d",
    monthly: "%Y-%m",
};

/** The $dateToString format string Mongo should group by. */
function bucketFormat(period) {
    return BUCKET_FORMAT[period] || BUCKET_FORMAT.daily;
}

/**
 * Default window when the caller supplies no range.
 *   daily   -> the current month, so the chart reads as "this month, day by day"
 *   monthly -> the last 12 months
 */
function defaultRange(period) {
    const tz = timezone();
    if (period === "monthly") {
        return {
            start: moment.tz(tz).subtract(11, "months").startOf("month").toDate(),
            end: moment.tz(tz).endOf("month").toDate(),
        };
    }
    return {
        start: moment.tz(tz).startOf("month").toDate(),
        end: moment.tz(tz).endOf("month").toDate(),
    };
}

/** Absolute UTC bounds for a chart request. */
function seriesRange({ period = "daily", from, to } = {}) {
    const tz = timezone();
    if (!from && !to) return defaultRange(period);

    const unit = period === "monthly" ? "month" : "day";
    const fallback = defaultRange(period);

    return {
        start: from ? moment.tz(from, tz).startOf(unit).toDate() : fallback.start,
        end: to ? moment.tz(to, tz).endOf(unit).toDate() : fallback.end,
    };
}

/**
 * Every bucket key between start and end, inclusive, with a display label.
 * Used to pad days/months that saw no movement so the axis stays continuous.
 */
function bucketsBetween(start, end, period = "daily") {
    const tz = timezone();
    const unit = period === "monthly" ? "month" : "day";
    const keyFormat = period === "monthly" ? "YYYY-MM" : "YYYY-MM-DD";
    const labelFormat = period === "monthly" ? "MMM YY" : "DD MMM";

    const cursor = moment.tz(start, tz).startOf(unit);
    const last = moment.tz(end, tz).endOf(unit);

    const out = [];
    // Guard against a pathological range producing an unbounded array.
    const MAX_BUCKETS = 400;
    while (cursor.isSameOrBefore(last) && out.length < MAX_BUCKETS) {
        out.push({ key: cursor.format(keyFormat), label: cursor.format(labelFormat) });
        cursor.add(1, unit);
    }
    return out;
}

module.exports = {
    DEFAULT_TIMEZONE,
    PERIODS,
    timezone,
    isValidTimezone,
    assertValidTimezone,
    dayRange,
    bucketFormat,
    defaultRange,
    seriesRange,
    bucketsBetween,
};
