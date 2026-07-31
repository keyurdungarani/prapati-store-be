const ReturnOrder = require('../../models/returnOrder');
const ExcelJS = require('exceljs');
const moment = require('moment');
const { renderPdf, sendPdf, sendPdfError } = require('../../utils/pdfService');
const layout = require('../../utils/reportLayout');

module.exports = {
    // Create a new return order
    createReturnOrder: async (req, res) => {
        try {
            const { date, product, qty, price, company, platforms, returnReason, returnBy } = req.body;

            // Validate input
            if (!date || !product || !qty || !price || !company || !platforms || !returnReason || !returnBy) {
                return res.status(400).json({
                    statusCode: 400,
                    message: 'All fields (date, product, qty, price, company, platforms, returnReason, returnBy) are required',
                });
            }

            // Calculate total price
            const totalPrice = qty * price;

            // Create and save the return order
            const returnOrder = new ReturnOrder({
                user: req.user.userId,
                date,
                product,
                qty,
                price,
                totalPrice,
                company,
                platforms,
                returnReason,
                returnBy,
            });

            await returnOrder.save();

            return res.status(201).json({
                statusCode: 201,
                message: 'Return order created successfully',
                data: returnOrder,
            });

        } catch (err) {
            return res.status(500).json({
                statusCode: 500,
                message: 'Internal Server Error',
            });
        }
    },

    // Get all return orders with optional filters
    getReturnOrders: async (req, res) => {
        try {
            const { company, platforms, returnReason, returnBy, startDate, endDate } = req.query;
            let filter = { user: req.user.userId };

            if (company) filter.company = company;
            if (platforms) filter.platforms = platforms;
            if (returnReason) filter.returnReason = returnReason;
            if (returnBy) filter.returnBy = returnBy;
            if (startDate && endDate) {
                filter.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
            }

            const returnOrders = await ReturnOrder.find(filter).sort({ date: -1 });

            // Format the date to DD-MM-YYYY
            const formattedReturnOrders = returnOrders.map(order => ({
                ...order._doc,
            }));

            return res.status(200).json({
                statusCode: 200,
                message: 'Return orders retrieved successfully',
                data: formattedReturnOrders,
            });

        } catch (err) {
            return res.status(500).json({
                statusCode: 500,
                message: 'Internal Server Error',
            });
        }
    },

    // Update a return order by ID
    updateReturnOrder: async (req, res) => {
        try {
            const { id } = req.params;
            const { qty, price } = req.body;

            // Recalculate total price if qty or price is updated
            if (qty || price) {
                const existing = await ReturnOrder.findOne({ _id: id, user: req.user.userId });
                if (!existing) {
                    return res.status(404).json({
                        statusCode: 404,
                        message: 'Return order not found',
                    });
                }

                const updatedQty = qty || existing.qty;
                const updatedPrice = price || existing.price;
                req.body.totalPrice = updatedQty * updatedPrice;
            }

            const returnOrder = await ReturnOrder.findOneAndUpdate(
                { _id: id, user: req.user.userId },
                req.body,
                { new: true, runValidators: true }
            );

            if (!returnOrder) {
                return res.status(404).json({
                    statusCode: 404,
                    message: 'Return order not found',
                });
            }

            return res.status(200).json({
                statusCode: 200,
                message: 'Return order updated successfully',
                data: returnOrder,
            });

        } catch (err) {
            return res.status(500).json({
                statusCode: 500,
                message: 'Internal Server Error',
            });
        }
    },

    // Delete a return order by ID
    deleteReturnOrder: async (req, res) => {
        try {
            const { id } = req.params;

            const returnOrder = await ReturnOrder.findOneAndDelete({ _id: id, user: req.user.userId });

            if (!returnOrder) {
                return res.status(404).json({
                    statusCode: 404,
                    message: 'Return order not found',
                });
            }

            return res.status(200).json({
                statusCode: 200,
                message: 'Return order deleted successfully',
            });

        } catch (err) {
            return res.status(500).json({
                statusCode: 500,
                message: 'Internal Server Error',
            });
        }
    },

    // Generate return order report (Excel blob)
    generateReturnOrderReport: async (req, res) => {
        try {
            let { startDate, endDate, company, returnReason, returnBy } = req.body;

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

            if (company && company !== 'all') filter.company = company;
            if (returnReason && returnReason !== 'all') filter.returnReason = returnReason;
            if (returnBy && returnBy !== 'all') filter.returnBy = returnBy;

            // Fetch return orders based on filter
            const returnOrders = await ReturnOrder.find(filter).sort({ date: -1 });

            // Create workbook & worksheet
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('RETURN ORDERS REPORT');

            worksheet.columns = [
                { header: "DATE", key: "date", width: 20 },
                { header: "PRODUCT", key: "product", width: 30 },
                { header: "QUANTITY", key: "qty", width: 15 },
                { header: "PRICE", key: "price", width: 15 },
                { header: "TOTAL PRICE", key: "totalPrice", width: 20 },
                { header: "COMPANY", key: "company", width: 30 },
                { header: "PLATFORMS", key: "platforms", width: 30 },
                { header: "RETURN REASON", key: "returnReason", width: 20 },
                { header: "RETURN BY", key: "returnBy", width: 15 },
            ];

            // Header styling
            worksheet.getRow(1).eachCell((cell) => {
                cell.font = { bold: true };
                cell.alignment = { horizontal: "center", vertical: "middle" };
                cell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "FF6B6B" },
                };
            });

            let totalQtySum = 0;
            let totalPriceSum = 0;
            let totalOverallPriceSum = 0;

            returnOrders.forEach(order => {
                worksheet.addRow({
                    date: moment(order.date).format('DD-MM-YYYY'),
                    product: order.product,
                    qty: order.qty,
                    price: order.price,
                    totalPrice: order.totalPrice,
                    company: order.company,
                    platforms: Array.isArray(order.platforms) ? order.platforms.join(', ') : order.platforms,
                    returnReason: order.returnReason,
                    returnBy: order.returnBy,
                }).eachCell((cell) => {
                    cell.alignment = { horizontal: "center", vertical: "middle" };
                });

                totalQtySum += order.qty;
                totalPriceSum += order.price;
                totalOverallPriceSum += order.totalPrice;
            });

            // Add total row
            worksheet.addRow({});
            const totalRow = worksheet.addRow({
                date: "TOTAL",
                product: "",
                qty: totalQtySum,
                price: totalPriceSum.toFixed(2),
                totalPrice: totalOverallPriceSum.toFixed(2),
                company: "",
                platforms: "",
                returnReason: "",
                returnBy: "",
            });

            totalRow.eachCell((cell) => {
                cell.font = { bold: true };
                cell.alignment = { horizontal: "center", vertical: "middle" };
                cell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "FFC107" },
                };
            });

            // Set filename
            const filename = "return_orders_report.xlsx";
            res.setHeader(
                "Content-Disposition",
                `attachment; filename=${filename}`
            );
            res.setHeader(
                "Content-Type",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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

    // Build the pdfmake document definition for the return orders report
    buildReturnOrderReportDocument: (returnOrders, filters, startDate, endDate) => {
        const dateRange = layout.dateRangeLabel(startDate, endDate);
        const accent = layout.ACCENT.returns;

        const sum = (key) => returnOrders.reduce((acc, o) => acc + (Number(o[key]) || 0), 0);
        const rtoCount = returnOrders.filter((o) => o.returnBy === 'RTO').length;
        const customerCount = returnOrders.filter((o) => o.returnBy === 'Customer').length;

        const columns = [
            { header: 'Date', width: 52 },
            { header: 'Product', width: '*' },
            { header: 'Qty', width: 26, align: 'center' },
            { header: 'Price', width: 48, align: 'right' },
            { header: 'Total', width: 52, align: 'right' },
            { header: 'Company', width: 62 },
            { header: 'Platforms', width: 62 },
            { header: 'Return Reason', width: 60 },
            { header: 'Return By', width: 46 },
        ];

        const rows = returnOrders.map((order) => [
            layout.formatDate(order.date),
            order.product,
            layout.count(order.qty),
            layout.money(order.price),
            layout.money(order.totalPrice),
            order.company || '',
            Array.isArray(order.platforms) ? order.platforms.join(', ') : (order.platforms || ''),
            order.returnReason || '',
            order.returnBy || '',
        ]);

        const appliedFilters = [
            filters.company && filters.company !== 'all' ? `Company: ${filters.company}` : null,
            filters.returnReason && filters.returnReason !== 'all' ? `Return Reason: ${filters.returnReason}` : null,
            filters.returnBy && filters.returnBy !== 'all' ? `Return By: ${filters.returnBy}` : null,
            `Date Range: ${dateRange}`,
        ].filter(Boolean).join('   |   ');

        const content = layout.reportHeader('RETURN ORDERS REPORT', accent, [
            `Period: ${dateRange}`,
            `Generated on: ${moment().format('DD-MM-YYYY HH:mm:ss')}`,
        ]);

        content.push(layout.filtersBox(appliedFilters));

        content.push(layout.summaryCards([
            { label: 'Total Returns', value: String(returnOrders.length) },
            { label: 'Total Quantity', value: layout.count(sum('qty')) },
            { label: 'Total Amount', value: layout.money(sum('totalPrice')) },
            { label: 'RTO Returns', value: String(rtoCount) },
            { label: 'Customer Returns', value: String(customerCount) },
        ], accent));

        content.push(layout.dataTable({
            columns,
            rows,
            fontSize: 7,
            totalRow: [
                ...layout.totalCell('TOTAL', { colSpan: 2 }),
                { text: layout.count(sum('qty')), bold: true, alignment: 'center' },
                { text: layout.money(sum('price')), bold: true, alignment: 'right' },
                { text: layout.money(sum('totalPrice')), bold: true, alignment: 'right' },
                ...layout.totalCell('', { colSpan: 4 }),
            ],
            accent,
        }));

        content.push(layout.reportFooter());

        return layout.documentShell({ title: 'RETURN ORDERS REPORT', content });
    },

    // Generate PDF report
    generateReturnOrderReportPDF: async (req, res) => {
        try {
            let { startDate, endDate, company, returnReason, returnBy } = req.body;

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

            if (company && company !== 'all') filter.company = company;
            if (returnReason && returnReason !== 'all') filter.returnReason = returnReason;
            if (returnBy && returnBy !== 'all') filter.returnBy = returnBy;

            // Fetch return orders based on filter
            const returnOrders = await ReturnOrder.find(filter).sort({ date: -1 });

            // Generate HTML content
            const filters = { company, returnReason, returnBy };
            const docDefinition = module.exports.buildReturnOrderReportDocument(returnOrders, filters, startDate, endDate);

            const pdfBuffer = await renderPdf(docDefinition);

            sendPdf(res, pdfBuffer, 'return_orders_report.pdf');

        } catch (err) {
            return sendPdfError(res, err, 'Return order report PDF');
        }
    },
};
