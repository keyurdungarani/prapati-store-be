const Order = require('../../models/order');
const ExcelJS = require('exceljs');
const moment = require('moment');
const { renderPdf, sendPdf, sendPdfError } = require('../../utils/pdfService');
const layout = require('../../utils/reportLayout');

module.exports = {
    // Create a new order
    createOrder: async (req, res) => {
        try {
            const { date, product, qty, price, company, platforms } = req.body;

            // Validate input
            if (!date || !product || !qty || !price || !company || !platforms) {
                return res.status(400).json({
                    statusCode: 400,
                    message: 'All fields (date, product, qty, price, company, platforms) are required',
                });
            }

            // Calculate total price
            const totalPrice = qty * price;

            // Create and save the order scoped to the authenticated user
            const order = new Order({
                user: req.user.userId,
                date,
                product,
                qty,
                price,
                totalPrice,
                company,
                platforms,
            });

            await order.save();

            return res.status(201).json({
                statusCode: 201,
                message: 'Order created successfully',
                data: order,
            });

        } catch (err) {
            return res.status(500).json({
                statusCode: 500,
                message: 'Internal Server Error',
            });
        }
    },

    // Get all orders with optional filters
    getOrders: async (req, res) => {
        try {
            const { company, platforms, startDate, endDate } = req.query;
            let filter = { user: req.user.userId };

            if (company) filter.company = company;
            if (platforms) filter.platforms = platforms;
            if (startDate && endDate) {
                filter.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
            }

            const orders = await Order.find(filter).sort({ date: -1 });

            // Dont Format the date 
            const formattedOrders = orders.map(order => ({
                ...order._doc,
            }));

            return res.status(200).json({
                statusCode: 200,
                message: 'Orders retrieved successfully',
                data: formattedOrders,
            });

        } catch (err) {
            return res.status(500).json({
                statusCode: 500,
                message: 'Internal Server Error',
            });
        }
    },

    // Update an order by ID
    updateOrder: async (req, res) => {
        try {
            const { id } = req.params;
            const { qty, price } = req.body;

            // Recalculate total price if qty or price is updated
            if (qty || price) {
                const existing = await Order.findOne({ _id: id, user: req.user.userId });
                if (!existing) {
                    return res.status(404).json({
                        statusCode: 404,
                        message: 'Order not found',
                    });
                }

                const updatedQty = qty || existing.qty;
                const updatedPrice = price || existing.price;
                req.body.totalPrice = updatedQty * updatedPrice;
            }

            const order = await Order.findOneAndUpdate(
                { _id: id, user: req.user.userId },
                req.body,
                { new: true, runValidators: true }
            );

            if (!order) {
                return res.status(404).json({
                    statusCode: 404,
                    message: 'Order not found',
                });
            }

            return res.status(200).json({
                statusCode: 200,
                message: 'Order updated successfully',
                data: order,
            });

        } catch (err) {
            return res.status(500).json({
                statusCode: 500,
                message: 'Internal Server Error',
            });
        }
    },

    // Delete an order by ID
    deleteOrder: async (req, res) => {
        try {
            const { id } = req.params;

            const order = await Order.findOneAndDelete({ _id: id, user: req.user.userId });

            if (!order) {
                return res.status(404).json({
                    statusCode: 404,
                    message: 'Order not found',
                });
            }

            return res.status(200).json({
                statusCode: 200,
                message: 'Order deleted successfully',
            });

        } catch (err) {
            return res.status(500).json({
                statusCode: 500,
                message: 'Internal Server Error',
            });
        }
    },

    // Generate order report (Excel blob)
    generateOrderReport: async (req, res) => {
        try {
            let { startDate, endDate, company } = req.body;

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

            if (company && company !== 'all') {
                filter.company = company;
            }

            // Fetch orders based on filter
            const orders = await Order.find(filter).sort({ date: -1 });

            // Create workbook & worksheet
            const workbook = new ExcelJS.Workbook();
            
            if (company && company !== 'all') {
                // Company-specific report
                const worksheet = workbook.addWorksheet(`${company.toUpperCase()} ORDERS`);
                
                worksheet.columns = [
                    { header: "DATE", key: "date", width: 20 },
                    { header: "PRODUCT", key: "product", width: 30 },
                    { header: "QUANTITY", key: "qty", width: 15 },
                    { header: "PRICE", key: "price", width: 15 },
                    { header: "TOTAL PRICE", key: "totalPrice", width: 20 },
                    { header: "PLATFORMS", key: "platforms", width: 30 },
                ];

                // Header styling
                worksheet.getRow(1).eachCell((cell) => {
                    cell.font = { bold: true };
                    cell.alignment = { horizontal: "center", vertical: "middle" };
                    cell.fill = {
                        type: "pattern",
                        pattern: "solid",
                        fgColor: { argb: "4CAF50" },
                    };
                });

                let totalQtySum = 0;
                let totalPriceSum = 0;
                let totalOverallPriceSum = 0;

                orders.forEach(order => {
                    worksheet.addRow({
                        date: moment(order.date).format('DD-MM-YYYY'),
                        product: order.product,
                        qty: order.qty,
                        price: order.price,
                        totalPrice: order.totalPrice,
                        platforms: Array.isArray(order.platforms) ? order.platforms.join(', ') : order.platforms,
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
                    platforms: "",
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

                // Set filename for company-specific export
                res.setHeader(
                    "Content-Disposition",
                    `attachment; filename=${company.replace(/[^a-zA-Z0-9]/g, '_')}_orders_report.xlsx`
                );
            } else {
                // All companies report with grouping
                const worksheet = workbook.addWorksheet('ALL COMPANIES ORDERS');
                
                worksheet.columns = [
                    { header: "DATE", key: "date", width: 20 },
                    { header: "PRODUCT", key: "product", width: 30 },
                    { header: "QUANTITY", key: "qty", width: 15 },
                    { header: "PRICE", key: "price", width: 15 },
                    { header: "TOTAL PRICE", key: "totalPrice", width: 20 },
                    { header: "COMPANY", key: "company", width: 30 },
                    { header: "PLATFORMS", key: "platforms", width: 30 },
                ];

                // Header styling
                worksheet.getRow(1).eachCell((cell) => {
                    cell.font = { bold: true };
                    cell.alignment = { horizontal: "center", vertical: "middle" };
                    cell.fill = {
                        type: "pattern",
                        pattern: "solid",
                        fgColor: { argb: "2196F3" },
                    };
                });

                // Group orders by company
                const groupedOrders = orders.reduce((acc, order) => {
                    if (!acc[order.company]) {
                        acc[order.company] = [];
                    }
                    acc[order.company].push(order);
                    return acc;
                }, {});

                let grandTotalQty = 0;
                let grandTotalPrice = 0;
                let grandTotalOverallPrice = 0;

                // Add orders grouped by company
                Object.keys(groupedOrders).forEach(companyName => {
                    const companyOrders = groupedOrders[companyName];
                    
                    // Company header
                    const companyHeaderRow = worksheet.addRow({
                        date: `═══ ${companyName.toUpperCase()} ═══`,
                        product: "",
                        qty: "",
                        price: "",
                        totalPrice: "",
                        company: "",
                        platforms: "",
                    });
                    companyHeaderRow.eachCell((cell) => {
                        cell.font = { bold: true, color: { argb: "FFFFFF" } };
                        cell.alignment = { horizontal: "center", vertical: "middle" };
                        cell.fill = {
                            type: "pattern",
                            pattern: "solid",
                            fgColor: { argb: "FF5722" },
                        };
                    });

                    let companyQtySum = 0;
                    let companyPriceSum = 0;
                    let companyOverallPriceSum = 0;

                    companyOrders.forEach(order => {
                        worksheet.addRow({
                            date: moment(order.date).format('DD-MM-YYYY'),
                            product: order.product,
                            qty: order.qty,
                            price: order.price,
                            totalPrice: order.totalPrice,
                            company: order.company,
                            platforms: Array.isArray(order.platforms) ? order.platforms.join(', ') : order.platforms,
                        }).eachCell((cell) => {
                            cell.alignment = { horizontal: "center", vertical: "middle" };
                        });

                        companyQtySum += order.qty;
                        companyPriceSum += order.price;
                        companyOverallPriceSum += order.totalPrice;
                    });

                    // Company subtotal
                    const subtotalRow = worksheet.addRow({
                        date: `${companyName} SUBTOTAL`,
                        product: "",
                        qty: companyQtySum,
                        price: companyPriceSum.toFixed(2),
                        totalPrice: companyOverallPriceSum.toFixed(2),
                        company: "",
                        platforms: "",
                    });
                    subtotalRow.eachCell((cell) => {
                        cell.font = { bold: true };
                        cell.alignment = { horizontal: "center", vertical: "middle" };
                        cell.fill = {
                            type: "pattern",
                            pattern: "solid",
                            fgColor: { argb: "E8F5E8" },
                        };
                    });

                    // Add spacing
                    worksheet.addRow({});

                    grandTotalQty += companyQtySum;
                    grandTotalPrice += companyPriceSum;
                    grandTotalOverallPrice += companyOverallPriceSum;
                });

                // Grand total
                const grandTotalRow = worksheet.addRow({
                    date: "GRAND TOTAL",
                    product: "",
                    qty: grandTotalQty,
                    price: grandTotalPrice.toFixed(2),
                    totalPrice: grandTotalOverallPrice.toFixed(2),
                    company: "",
                    platforms: "",
                });

                grandTotalRow.eachCell((cell) => {
                    cell.font = { bold: true, color: { argb: "FFFFFF" } };
                    cell.alignment = { horizontal: "center", vertical: "middle" };
                    cell.fill = {
                        type: "pattern",
                        pattern: "solid",
                        fgColor: { argb: "4CAF50" },
                    };
                });

                // Set filename for all companies export
                res.setHeader(
                    "Content-Disposition",
                    "attachment; filename=all_companies_orders_report.xlsx"
                );
            }

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

    // Get orders grouped by company
    getOrdersByCompany: async (req, res) => {
        try {
            const { startDate, endDate } = req.query;
            let filter = { user: req.user.userId };

            if (startDate && endDate) {
                filter.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
            }

            const orders = await Order.find(filter).sort({ company: 1, date: -1 });

            // Group orders by company
            const groupedOrders = orders.reduce((acc, order) => {
                const formattedOrder = {
                    ...order._doc,
                };
                
                if (!acc[order.company]) {
                    acc[order.company] = {
                        orders: [],
                        totalQty: 0,
                        totalAmount: 0,
                        orderCount: 0
                    };
                }
                
                acc[order.company].orders.push(formattedOrder);
                acc[order.company].totalQty += order.qty;
                acc[order.company].totalAmount += order.totalPrice;
                acc[order.company].orderCount += 1;
                
                return acc;
            }, {});

            return res.status(200).json({
                statusCode: 200,
                message: 'Orders grouped by company retrieved successfully',
                data: groupedOrders,
            });

        } catch (err) {
            return res.status(500).json({
                statusCode: 500,
                message: 'Internal Server Error',
            });
        }
    },

    // Build the pdfmake document definition for the orders report
    buildOrderReportDocument: (orders, company, startDate, endDate) => {
        const isCompanySpecific = company && company !== 'all';
        const reportTitle = isCompanySpecific
            ? `${company.toUpperCase()} ORDERS REPORT`
            : 'ALL COMPANIES ORDERS REPORT';
        const dateRange = layout.dateRangeLabel(startDate, endDate);
        const accent = layout.ACCENT.orders;

        const columns = [
            { header: 'Date', width: 58 },
            { header: 'Product', width: '*' },
            { header: 'Quantity', width: 46, align: 'center' },
            { header: 'Price', width: 58, align: 'right' },
            { header: 'Total', width: 62, align: 'right' },
            { header: 'Platforms', width: 84 },
        ];

        const toRow = (order) => [
            layout.formatDate(order.date),
            order.product,
            layout.count(order.qty),
            layout.money(order.price),
            layout.money(order.totalPrice),
            Array.isArray(order.platforms) ? order.platforms.join(', ') : (order.platforms || ''),
        ];

        const sum = (list, key) => list.reduce((acc, item) => acc + (Number(item[key]) || 0), 0);

        // TOTAL / SUBTOTAL rows share the same shape across every block.
        const totalsRow = (label, list) => [
            ...layout.totalCell(label, { colSpan: 2 }),
            { text: layout.count(sum(list, 'qty')), bold: true, alignment: 'center' },
            { text: layout.money(sum(list, 'price')), bold: true, alignment: 'right' },
            { text: layout.money(sum(list, 'totalPrice')), bold: true, alignment: 'right' },
            { text: '' },
        ];

        const content = layout.reportHeader(reportTitle, accent, [
            `Period: ${dateRange}`,
            `Generated on: ${moment().format('DD-MM-YYYY HH:mm:ss')}`,
        ]);

        if (isCompanySpecific) {
            content.push(layout.summaryCards([
                { label: 'Total Orders', value: String(orders.length) },
                { label: 'Total Quantity', value: layout.count(sum(orders, 'qty')) },
                { label: 'Total Revenue', value: layout.money(sum(orders, 'totalPrice')) },
            ], accent));

            content.push(layout.dataTable({
                columns,
                rows: orders.map(toRow),
                totalRow: totalsRow('TOTAL', orders),
                accent,
            }));
        } else {
            const grouped = orders.reduce((acc, order) => {
                const key = order.company || 'UNSPECIFIED';
                (acc[key] = acc[key] || []).push(order);
                return acc;
            }, {});

            content.push(layout.summaryCards([
                { label: 'Total Companies', value: String(Object.keys(grouped).length) },
                { label: 'Total Orders', value: String(orders.length) },
                { label: 'Total Quantity', value: layout.count(sum(orders, 'qty')) },
                { label: 'Total Revenue', value: layout.money(sum(orders, 'totalPrice')) },
            ], accent));

            Object.entries(grouped).forEach(([companyName, companyOrders]) => {
                const stats = [
                    `Orders: ${companyOrders.length}`,
                    `Qty: ${layout.count(sum(companyOrders, 'qty'))}`,
                    `Revenue: ${layout.money(sum(companyOrders, 'totalPrice'))}`,
                ].join('   |   ');

                content.push(layout.sectionHeading(companyName, accent, stats));
                content.push(layout.dataTable({
                    columns,
                    rows: companyOrders.map(toRow),
                    totalRow: totalsRow(`${companyName} SUBTOTAL`, companyOrders),
                    accent,
                }));
            });

            if (orders.length) {
                content.push(layout.dataTable({
                    columns,
                    rows: [],
                    totalRow: totalsRow('GRAND TOTAL', orders),
                    accent,
                    showHeader: false,
                }));
            }
        }

        content.push(layout.reportFooter());

        return layout.documentShell({ title: reportTitle, content });
    },

    // Generate PDF report
    generateOrderReportPDF: async (req, res) => {
        try {
            let { startDate, endDate, company } = req.body;

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

            if (company && company !== 'all') {
                filter.company = company;
            }

            // Fetch orders based on filter
            const orders = await Order.find(filter).sort({ date: -1 });

            // Build the document definition and render it with pdfmake
            const docDefinition = module.exports.buildOrderReportDocument(orders, company, startDate, endDate);
            const pdfBuffer = await renderPdf(docDefinition);

            // Set response headers
            const filename = company && company !== 'all' 
                ? `${company.replace(/[^a-zA-Z0-9]/g, '_')}_orders_report.pdf`
                : "all_companies_orders_report.pdf";

            sendPdf(res, pdfBuffer, filename);

        } catch (err) {
            return sendPdfError(res, err, 'Order report PDF');
        }
    }
};
