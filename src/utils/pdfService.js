"use strict";

/**
 * PDF rendering, backed by pdfmake.
 *
 * This used to drive a headless Chrome via Puppeteer, which meant the server
 * needed ~40 native shared libraries installed at the OS level. A freshly
 * provisioned host without them failed with "libatk-1.0.so.0: cannot open
 * shared object file", and the same breakage returned on every migration.
 *
 * pdfmake is pure JavaScript, so a PDF renders with nothing but `npm install`.
 * There is no browser to launch, no OS packages to install, no per-request
 * process to reap and no concurrency limit needed to protect memory.
 *
 * Fonts are read from pdfmake's bundled Roboto and decoded once into Buffers,
 * so no font files need to ship or be located on disk at runtime. Roboto covers
 * the rupee sign (U+20B9) that every report uses for amounts.
 */

const PdfPrinter = require("pdfmake");

/** pdfmake ships Roboto as base64 in a VFS bundle; decode it once at startup. */
function loadFonts() {
    const bundle = require("pdfmake/build/vfs_fonts.js");
    const vfs = (bundle && bundle.pdfMake && bundle.pdfMake.vfs) || bundle.vfs || bundle;

    const file = (name) => {
        const encoded = vfs[name];
        if (!encoded) throw new Error(`pdfmake font "${name}" is missing from the bundled VFS.`);
        return Buffer.from(encoded, "base64");
    };

    // The bundle carries no Roboto-Bold, so bold maps to Roboto-Medium.
    return {
        Roboto: {
            normal: file("Roboto-Regular.ttf"),
            bold: file("Roboto-Medium.ttf"),
            italics: file("Roboto-Italic.ttf"),
            bolditalics: file("Roboto-MediumItalic.ttf"),
        },
    };
}

const printer = new PdfPrinter(loadFonts());

/**
 * Render a pdfmake document definition to a Buffer.
 *
 * @param {object} docDefinition
 * @returns {Promise<Buffer>}
 */
function renderPdf(docDefinition) {
    if (!docDefinition || typeof docDefinition !== "object") {
        const err = new Error("A pdfmake document definition is required.");
        err.code = "PDF_INVALID_DEFINITION";
        return Promise.reject(err);
    }

    return new Promise((resolve, reject) => {
        let doc;
        try {
            doc = printer.createPdfKitDocument(docDefinition);
        } catch (err) {
            return reject(err);
        }

        const chunks = [];
        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("error", reject);
        doc.on("end", () => resolve(Buffer.concat(chunks)));

        try {
            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

/** Send a rendered PDF as a download with consistent headers. */
function sendPdf(res, pdfBuffer, filename) {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);
}

/**
 * Shared failure response for report endpoints. Returns false when the response
 * has already begun streaming, in which case writing a JSON body on top would
 * throw ERR_HTTP_HEADERS_SENT and corrupt the download instead of reporting it.
 */
function sendPdfError(res, err, context) {
    console.error(`[pdfService] ${context} failed:`, err);

    if (res.headersSent) {
        res.destroy();
        return false;
    }

    res.status(500).json({
        statusCode: 500,
        message: "PDF generation failed",
        error: (err && err.message) || "Unknown error",
    });
    return true;
}

module.exports = { renderPdf, sendPdf, sendPdfError };
