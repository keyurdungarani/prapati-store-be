"use strict";

/**
 * Shared building blocks for every PDF report.
 *
 * These helpers exist so all five reports share one visual language and so a
 * change to (say) the table styling happens in one place instead of five HTML
 * template strings. Each report keeps its own accent colour, which matches the
 * colour its HTML version used.
 */

const moment = require("moment");

/** Accent colours carried over from the original HTML reports. */
const ACCENT = {
    orders: "#008080",
    returns: "#FF6B6B",
    taproll: "#6C5CE7",
    kraftMailer: "#E17055",
    summary: "#2c3e50",
    productStock: "#0984E3",
};

const INK = "#212529";
const MUTED = "#6c757d";
const RULE = "#dee2e6";
const ZEBRA = "#f7f8fa";

const FOOTER_NOTE = [
    "This report was generated automatically by Prapatti Store Admin System",
    "For any queries, please contact the administration team",
];

/** Format a date the way every report has always formatted it. */
const formatDate = (value) => (value ? moment(value).format("DD-MM-YYYY") : "");

/** Currency, always to two decimals and resilient to null/undefined/strings. */
function money(value) {
    const n = Number(value);
    return "₹" + (Number.isFinite(n) ? n : 0).toFixed(2);
}

/** Plain number, resilient to missing values. */
function count(value) {
    const n = Number(value);
    return String(Number.isFinite(n) ? n : 0);
}

/** "01-07-2026 to 31-07-2026", or "All Time" when unbounded. */
function dateRangeLabel(startDate, endDate) {
    return startDate && endDate ? `${formatDate(startDate)} to ${formatDate(endDate)}` : "All Time";
}

/** Title block: report name, period, generation timestamp, accent rule. */
function reportHeader(title, accent, subtitleLines = []) {
    return [
        { text: title, style: "title", color: accent },
        ...subtitleLines.map((line) => ({ text: line, style: "subtitle" })),
        {
            canvas: [{ type: "line", x1: 0, y1: 0, x2: 535, y2: 0, lineWidth: 2, lineColor: accent }],
            margin: [0, 8, 0, 14],
        },
    ];
}

/** Grey "Applied Filters" strip. Pass an already-joined description string. */
function filtersBox(text) {
    return {
        table: {
            widths: ["*"],
            body: [[{ text: [{ text: "Applied Filters:  ", bold: true }, { text }], style: "filters" }]],
        },
        layout: {
            hLineWidth: () => 0,
            vLineWidth: () => 0,
            fillColor: () => "#f1f3f5",
            paddingLeft: () => 10,
            paddingRight: () => 10,
            paddingTop: () => 7,
            paddingBottom: () => 7,
        },
        margin: [0, 0, 0, 14],
    };
}

/**
 * Row(s) of summary tiles. Cards are laid out three per row and padded so the
 * last row keeps the same column widths as the rows above it.
 */
function summaryCards(cards, accent) {
    if (!cards.length) return [];

    const PER_ROW = 3;
    const rows = [];

    for (let i = 0; i < cards.length; i += PER_ROW) {
        const slice = cards.slice(i, i + PER_ROW);
        while (slice.length < PER_ROW) slice.push(null);

        rows.push(
            slice.map((card) =>
                card === null
                    ? { text: "", border: [false, false, false, false] }
                    : {
                          stack: [
                              { text: String(card.label).toUpperCase(), style: "cardLabel" },
                              { text: card.value, style: "cardValue", color: card.color || accent },
                          ],
                      }
            )
        );
    }

    return {
        table: { widths: Array(PER_ROW).fill("*"), body: rows },
        layout: {
            hLineWidth: () => 0,
            vLineWidth: () => 0,
            fillColor: (rowIndex, node, colIndex) => {
                const cell = node.table.body[rowIndex][colIndex];
                return cell && cell.text === "" ? null : "#f8f9fa";
            },
            paddingLeft: () => 10,
            paddingRight: () => 10,
            paddingTop: () => 8,
            paddingBottom: () => 8,
        },
        margin: [0, 0, 0, 16],
    };
}

/** Bold section heading used to separate per-company blocks. */
function sectionHeading(title, accent, statsLine) {
    const stack = [{ text: title, style: "sectionTitle", color: accent }];
    if (statsLine) stack.push({ text: statsLine, style: "sectionStats" });
    return { stack, margin: [0, 6, 0, 6] };
}

/**
 * Build a data table.
 *
 * @param {object[]} columns  [{ header, width, align }]
 * @param {Array[]}  rows     row values in column order (strings/numbers)
 * @param {Array}    totalRow optional pre-built pdfmake cells for a totals row
 * @param {string}   accent   header fill colour
 * @param {number}   fontSize body font size
 */
function dataTable({ columns, rows, totalRow = null, accent, fontSize = 8, showHeader = true, emptyMessage = "No records found for the selected period." }) {
    // With no rows there is nothing meaningful to total, so say so plainly
    // rather than printing a header above a row of zeros.
    if (showHeader && !rows.length) {
        return { text: emptyMessage, style: "empty", margin: [0, 8, 0, 16] };
    }

    const headerCells = columns.map((col) => ({
        text: col.header,
        style: "th",
        alignment: col.align || "left",
    }));

    const bodyRows = rows.map((row) =>
        row.map((value, index) => ({
            text: value === null || value === undefined ? "" : String(value),
            alignment: columns[index].align || "left",
        }))
    );

    const body = showHeader ? [headerCells, ...bodyRows] : [...bodyRows];
    if (totalRow) body.push(totalRow);

    const totalIndex = totalRow ? body.length - 1 : -1;
    const headerOffset = showHeader ? 0 : 1;

    return {
        table: {
            headerRows: showHeader ? 1 : 0,
            dontBreakRows: true,
            widths: columns.map((col) => col.width),
            body,
        },
        layout: {
            hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length ? 0.9 : 0.4),
            vLineWidth: () => 0,
            hLineColor: (i) => (i === 1 && showHeader ? accent : RULE),
            fillColor: (rowIndex) => {
                if (showHeader && rowIndex === 0) return accent;
                if (rowIndex === totalIndex) return "#eef1f4";
                return (rowIndex + headerOffset) % 2 === 0 ? ZEBRA : null;
            },
            paddingLeft: () => 6,
            paddingRight: () => 6,
            paddingTop: () => 4,
            paddingBottom: () => 4,
        },
        style: { fontSize },
        fontSize,
        margin: [0, 0, 0, 14],
    };
}

/** A bold cell, optionally spanning several columns. */
function totalCell(text, { colSpan = 1, align = "left" } = {}) {
    const cell = { text, bold: true, alignment: align };
    if (colSpan > 1) cell.colSpan = colSpan;
    return colSpan > 1 ? [cell, ...Array(colSpan - 1).fill({})] : [cell];
}

/** Closing note reproduced from the original reports. */
function reportFooter() {
    return {
        stack: FOOTER_NOTE.map((line) => ({ text: line, style: "footerNote" })),
        margin: [0, 18, 0, 0],
    };
}

/** Assemble a complete pdfmake document definition. */
function documentShell({ title, content, landscape = false, margins = [30, 36, 30, 40] }) {
    return {
        pageSize: "A4",
        pageOrientation: landscape ? "landscape" : "portrait",
        pageMargins: margins,
        info: { title, creator: "Prapatti Store Admin System", producer: "Prapatti Store Admin System" },
        defaultStyle: { font: "Roboto", fontSize: 9, color: INK, lineHeight: 1.15 },
        content,
        footer: (currentPage, pageCount) => ({
            text: `${currentPage} / ${pageCount}`,
            alignment: "center",
            fontSize: 8,
            color: MUTED,
            margin: [0, 12, 0, 0],
        }),
        styles: {
            title: { fontSize: 17, bold: true, alignment: "center", margin: [0, 0, 0, 4] },
            subtitle: { fontSize: 9, alignment: "center", color: MUTED, margin: [0, 1, 0, 0] },
            filters: { fontSize: 8.5, color: "#495057" },
            cardLabel: { fontSize: 7, bold: true, color: MUTED, margin: [0, 0, 0, 3] },
            cardValue: { fontSize: 13, bold: true },
            sectionTitle: { fontSize: 11, bold: true },
            sectionStats: { fontSize: 8, color: MUTED, margin: [0, 2, 0, 0] },
            th: { bold: true, color: "#ffffff", fontSize: 8 },
            empty: { fontSize: 9, italics: true, color: MUTED, alignment: "center" },
            footerNote: { fontSize: 8, color: MUTED, alignment: "center", margin: [0, 1, 0, 0] },
        },
    };
}

module.exports = {
    ACCENT,
    money,
    count,
    formatDate,
    dateRangeLabel,
    reportHeader,
    filtersBox,
    summaryCards,
    sectionHeading,
    dataTable,
    totalCell,
    reportFooter,
    documentShell,
};
