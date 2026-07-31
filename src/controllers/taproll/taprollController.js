const Taproll = require('../../models/taproll');
const moment = require('moment');
const ExcelJS = require('exceljs');
const { renderPdf, sendPdf, sendPdfError } = require('../../utils/pdfService');
const layout = require('../../utils/reportLayout');

const VALID_PLATFORMS = ['Amazon Taproll', 'Flipkart Taproll', 'Meesho Taproll'];

module.exports = {
    // Add a new taproll
    addTaproll: async (req, res) => {
        try {
            const { date, quantity, price, platform } = req.body;
            if (!date || !quantity || !price || !platform) {
                return res.status(400).json({
                    statusCode: 400,
                    message: 'All fields (date, quantity, price, platform) are required',
                });
            }
            if (!VALID_PLATFORMS.includes(platform)) {
                return res.status(400).json({
                    statusCode: 400,
                    message: `Platform must be one of: ${VALID_PLATFORMS.join(', ')}`,
                });
            }
            const totalPrice = quantity * price;
            const taproll = new Taproll({ user: req.user.userId, date, quantity, price, totalPrice, platform });
            await taproll.save();
            return res.status(201).json({
                statusCode: 201,
                message: 'Taproll added successfully',
                data: taproll,
            });
        } catch (err) {
            return res.status(500).json({
                statusCode: 500,
                message: 'Internal Server Error',
            });
        }
    },

    // List all taprolls
    listTaprolls: async (req, res) => {
        try {
            const taprolls = await Taproll.find({ user: req.user.userId });
            const formattedTaprolls = taprolls.map(taproll => ({
                ...taproll._doc,
                date: moment(taproll.date).format('DD-MM-YYYY'),
            }));
            return res.status(200).json({
                statusCode: 200,
                message: 'Taprolls retrieved successfully',
                data: formattedTaprolls,
            });
        } catch (err) {
            return res.status(500).json({
                statusCode: 500,
                message: 'Internal Server Error',
            });
        }
    },

    // Update a taproll by ID
    updateTaproll: async (req, res) => {
        try {
            const { id } = req.params;
            const { date, quantity, price, platform } = req.body;
            if (!date && !quantity && !price && !platform) {
                return res.status(400).json({
                    statusCode: 400,
                    message: 'At least one field is required to update',
                });
            }
            let updateFields = {};
            if (date !== undefined) updateFields.date = date;
            if (quantity !== undefined) updateFields.quantity = quantity;
            if (price !== undefined) updateFields.price = price;
            if (platform !== undefined) {
                if (!VALID_PLATFORMS.includes(platform)) {
                    return res.status(400).json({
                        statusCode: 400,
                        message: `Platform must be one of: ${VALID_PLATFORMS.join(', ')}`,
                    });
                }
                updateFields.platform = platform;
            }
            // Only calculate totalPrice if both quantity and price are provided
            if (typeof updateFields.quantity !== 'undefined' && typeof updateFields.price !== 'undefined') {
                updateFields.totalPrice = updateFields.quantity * updateFields.price;
            }
            const taproll = await Taproll.findOneAndUpdate(
                { _id: id, user: req.user.userId },
                updateFields,
                { new: true, runValidators: true }
            );
            if (!taproll) {
                return res.status(404).json({
                    statusCode: 404,
                    message: 'Taproll not found',
                });
            }
            return res.status(200).json({
                statusCode: 200,
                message: 'Taproll updated successfully',
                data: taproll,
            });
        } catch (err) {
            return res.status(500).json({
                statusCode: 500,
                message: 'Internal Server Error',
            });
        }
    },

    // Delete a taproll by ID
    deleteTaproll: async (req, res) => {
        try {
            const { id } = req.params;
            const taproll = await Taproll.findOneAndDelete({ _id: id, user: req.user.userId });
            if (!taproll) {
                return res.status(404).json({
                    statusCode: 404,
                    message: 'Taproll not found',
                });
            }
            return res.status(200).json({
                statusCode: 200,
                message: 'Taproll deleted successfully',
            });
        } catch (err) {
            return res.status(500).json({
                statusCode: 500,
                message: 'Internal Server Error',
            });
        }
    },

    // Generate Taproll Excel report
    generateTaprollReport: async (req, res) => {
        try {
            const body = req.body || {};
            let { startDate, endDate, platform } = body;
            if (!startDate || !endDate) {
                const now = new Date();
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
            } else {
                startDate = new Date(startDate);
                endDate = new Date(endDate);
            }
            let filter = {
                user: req.user.userId,
                date: { $gte: startDate, $lte: endDate }
            };
            if (platform && VALID_PLATFORMS.includes(platform)) {
                filter.platform = platform;
            }
            const taprolls = await Taproll.find(filter);

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('TAPROLL REPORT');

            worksheet.columns = [
                { header: "DATE", key: "date", width: 20 },
                { header: "QUANTITY", key: "quantity", width: 15 },
                { header: "PRICE", key: "price", width: 15 },
                { header: "TOTAL PRICE", key: "totalPrice", width: 20 },
                { header: "PLATFORM", key: "platform", width: 25 },
            ];

            worksheet.getRow(1).eachCell((cell) => {
                cell.font = { bold: true };
                cell.alignment = { horizontal: "center", vertical: "middle" };
                cell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "D3D3D3" },
                };
            });

            let totalQtySum = 0;
            let totalPriceSum = 0;
            let totalOverallPriceSum = 0;

            taprolls.forEach(taproll => {
                worksheet.addRow({
                    date: moment(taproll.date).format('DD-MM-YYYY'),
                    quantity: taproll.quantity,
                    price: taproll.price,
                    totalPrice: taproll.totalPrice,
                    platform: taproll.platform,
                }).eachCell((cell) => {
                    cell.alignment = { horizontal: "center", vertical: "middle" };
                });

                totalQtySum += taproll.quantity;
                totalPriceSum += taproll.price;
                totalOverallPriceSum += taproll.totalPrice;
            });

            worksheet.addRow({});

            const totalRow = worksheet.addRow({
                date: "TOTAL",
                quantity: totalQtySum,
                price: totalPriceSum.toFixed(2),
                totalPrice: totalOverallPriceSum.toFixed(2),
                platform: "",
            });

            totalRow.eachCell((cell) => {
                cell.font = { bold: true };
                cell.alignment = { horizontal: "center", vertical: "middle" };
                cell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "FFFF00" },
                };
            });

            res.setHeader(
                "Content-Disposition",
                "attachment; filename=taproll_report.xlsx"
            );
            await workbook.xlsx.write(res);
            res.end();

        } catch (err) {
            // The workbook streams straight into the response, so once it has
            // started there are no headers left to replace with a JSON error.
            if (res.headersSent) return res.destroy();

            return res.status(500).json({
                statusCode: 500,
                message: 'Internal Server Error',
            });
        }
    },

    // Build the pdfmake document definition for the taproll report
    buildTaprollReportDocument: (taprolls, startDate, endDate, platform) => {
        const dateRange = layout.dateRangeLabel(startDate, endDate);
        const accent = layout.ACCENT.taproll;

        const sum = (key) => taprolls.reduce((acc, t) => acc + (Number(t[key]) || 0), 0);
        const countBy = (name) => taprolls.filter((t) => t.platform === name).length;

        const columns = [
            { header: 'Date', width: 80 },
            { header: 'Quantity', width: 70, align: 'center' },
            { header: 'Price', width: 85, align: 'right' },
            { header: 'Total Price', width: 95, align: 'right' },
            { header: 'Platform', width: '*' },
        ];

        const rows = taprolls.map((taproll) => [
            layout.formatDate(taproll.date),
            layout.count(taproll.quantity),
            layout.money(taproll.price),
            layout.money(taproll.totalPrice),
            taproll.platform || '',
        ]);

        const appliedFilters = [
            platform && platform !== 'all' ? `Platform: ${platform}` : null,
            `Date Range: ${dateRange}`,
        ].filter(Boolean).join('   |   ');

        const content = layout.reportHeader('TAPROLL REPORT', accent, [
            `Period: ${dateRange}`,
            `Generated on: ${moment().format('DD-MM-YYYY HH:mm:ss')}`,
        ]);

        content.push(layout.filtersBox(appliedFilters));

        content.push(layout.summaryCards([
            { label: 'Total Records', value: String(taprolls.length) },
            { label: 'Total Quantity', value: layout.count(sum('quantity')) },
            { label: 'Total Amount', value: layout.money(sum('totalPrice')) },
            { label: 'Amazon', value: String(countBy('Amazon Taproll')) },
            { label: 'Flipkart', value: String(countBy('Flipkart Taproll')) },
            { label: 'Meesho', value: String(countBy('Meesho Taproll')) },
        ], accent));

        content.push(layout.dataTable({
            columns,
            rows,
            totalRow: [
                { text: 'TOTAL', bold: true },
                { text: layout.count(sum('quantity')), bold: true, alignment: 'center' },
                { text: layout.money(sum('price')), bold: true, alignment: 'right' },
                { text: layout.money(sum('totalPrice')), bold: true, alignment: 'right' },
                { text: '' },
            ],
            accent,
        }));

        content.push(layout.reportFooter());

        return layout.documentShell({ title: 'TAPROLL REPORT', content });
    },

    // Generate PDF report
    generateTaprollReportPDF: async (req, res) => {
        try {
            let { startDate, endDate, platform } = req.body;

            // Default: current month
            if (!startDate || !endDate) {
                const now = new Date();
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
            } else {
                startDate = new Date(startDate);
                endDate = new Date(endDate);
            }

            // Build filter query
            let filter = {
                user: req.user.userId,
                date: { $gte: startDate, $lte: endDate }
            };

            if (platform && platform !== 'all' && VALID_PLATFORMS.includes(platform)) {
                filter.platform = platform;
            }

            // Fetch taprolls based on filter
            const taprolls = await Taproll.find(filter).sort({ date: -1 });

            // Generate HTML content
            const docDefinition = module.exports.buildTaprollReportDocument(taprolls, startDate, endDate, platform);

            const pdfBuffer = await renderPdf(docDefinition);

            sendPdf(res, pdfBuffer, 'taproll_report.pdf');

        } catch (err) {
            return sendPdfError(res, err, 'Taproll report PDF');
        }
    },
};