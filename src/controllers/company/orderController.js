const Order = require('../../models/order');
const ExcelJS = require('exceljs');
const moment = require('moment');
const puppeteer = require('puppeteer');

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

            // Format the date to DD-MM-YYYY
            const formattedOrders = orders.map(order => ({
                ...order._doc,
                date: moment(order.date).format('DD-MM-YYYY'),
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
                    date: moment(order.date).format('DD-MM-YYYY'),
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

    // Helper function to generate HTML for PDF
    generateOrderReportHTML: (orders, company, startDate, endDate) => {
        const isCompanySpecific = company && company !== 'all';
        const reportTitle = isCompanySpecific ? `${company.toUpperCase()} ORDERS REPORT` : 'ALL COMPANIES ORDERS REPORT';
        const dateRange = startDate && endDate ? 
            `${moment(startDate).format('DD-MM-YYYY')} to ${moment(endDate).format('DD-MM-YYYY')}` : 
            'All Time';

        let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>${reportTitle}</title>
            <style>
                body { 
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                    margin: 0; 
                    padding: 20px; 
                    background-color: #f8f9fa;
                }
                .container { 
                    max-width: 1200px; 
                    margin: 0 auto; 
                    background: white; 
                    padding: 30px; 
                    border-radius: 10px; 
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                }
                .header { 
                    text-align: center; 
                    margin-bottom: 30px; 
                    border-bottom: 3px solid #008080; 
                    padding-bottom: 20px;
                }
                .header h1 { 
                    color: #008080; 
                    margin: 0; 
                    font-size: 28px; 
                    font-weight: bold;
                }
                .header .date-range { 
                    color: #666; 
                    margin-top: 8px; 
                    font-size: 14px;
                }
                .company-section { 
                    margin-bottom: 40px; 
                }
                .company-header { 
                    background: linear-gradient(135deg, #008080, #20b2aa); 
                    color: white; 
                    padding: 15px 20px; 
                    border-radius: 8px; 
                    margin-bottom: 15px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .company-header h2 { 
                    margin: 0; 
                    font-size: 20px;
                }
                .company-stats { 
                    font-size: 12px; 
                    opacity: 0.9;
                }
                table { 
                    width: 100%; 
                    border-collapse: collapse; 
                    margin-bottom: 20px; 
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                    border-radius: 8px;
                    overflow: hidden;
                }
                th { 
                    background: #f8f9fa; 
                    color: #333; 
                    font-weight: bold; 
                    padding: 12px 8px; 
                    text-align: left; 
                    font-size: 12px;
                    border-bottom: 2px solid #dee2e6;
                }
                td { 
                    padding: 10px 8px; 
                    border-bottom: 1px solid #dee2e6; 
                    font-size: 11px;
                }
                tr:nth-child(even) { 
                    background-color: #f8f9fa; 
                }
                tr:hover { 
                    background-color: #e3f2fd; 
                }
                .total-row { 
                    background: #e8f5e8 !important; 
                    font-weight: bold; 
                    color: #2e7d32;
                }
                .grand-total-row { 
                    background: #4caf50 !important; 
                    color: white !important; 
                    font-weight: bold;
                }
                .amount { 
                    text-align: right; 
                    font-weight: 500;
                }
                .platforms { 
                    font-size: 10px; 
                    color: #666;
                }
                .summary-cards {
                    display: flex;
                    justify-content: space-around;
                    margin: 20px 0;
                    gap: 15px;
                }
                .summary-card {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    padding: 15px;
                    border-radius: 8px;
                    text-align: center;
                    flex: 1;
                }
                .summary-card h3 {
                    margin: 0 0 5px 0;
                    font-size: 14px;
                    opacity: 0.9;
                }
                .summary-card .value {
                    font-size: 18px;
                    font-weight: bold;
                }
                .footer {
                    text-align: center;
                    margin-top: 30px;
                    padding-top: 20px;
                    border-top: 1px solid #dee2e6;
                    color: #666;
                    font-size: 12px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>${reportTitle}</h1>
                    <div class="date-range">Period: ${dateRange}</div>
                    <div class="date-range">Generated on: ${moment().format('DD-MM-YYYY HH:mm:ss')}</div>
                </div>
        `;

        if (isCompanySpecific) {
            // Company-specific report
            let totalQty = 0;
            let totalAmount = 0;

            orders.forEach(order => {
                totalQty += order.qty;
                totalAmount += order.totalPrice;
            });

            html += `
                <div class="summary-cards">
                    <div class="summary-card">
                        <h3>Total Orders</h3>
                        <div class="value">${orders.length}</div>
                    </div>
                    <div class="summary-card">
                        <h3>Total Quantity</h3>
                        <div class="value">${totalQty}</div>
                    </div>
                    <div class="summary-card">
                        <h3>Total Revenue</h3>
                        <div class="value">₹${totalAmount.toFixed(2)}</div>
                    </div>
                </div>

                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Product</th>
                            <th>Quantity</th>
                            <th>Price</th>
                            <th>Total</th>
                            <th>Platforms</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            orders.forEach(order => {
                html += `
                    <tr>
                        <td>${moment(order.date).format('DD-MM-YYYY')}</td>
                        <td>${order.product}</td>
                        <td>${order.qty}</td>
                        <td class="amount">₹${order.price}</td>
                        <td class="amount">₹${order.totalPrice}</td>
                        <td class="platforms">${Array.isArray(order.platforms) ? order.platforms.join(', ') : order.platforms}</td>
                    </tr>
                `;
            });

            html += `
                    <tr class="total-row">
                        <td colspan="2"><strong>TOTAL</strong></td>
                        <td><strong>${totalQty}</strong></td>
                        <td class="amount"><strong>₹${orders.reduce((sum, order) => sum + order.price, 0).toFixed(2)}</strong></td>
                        <td class="amount"><strong>₹${totalAmount.toFixed(2)}</strong></td>
                        <td></td>
                    </tr>
                </tbody>
                </table>
            `;
        } else {
            // All companies report with grouping
            const groupedOrders = orders.reduce((acc, order) => {
                if (!acc[order.company]) {
                    acc[order.company] = [];
                }
                acc[order.company].push(order);
                return acc;
            }, {});

            let grandTotalQty = 0;
            let grandTotalAmount = 0;

            // Summary cards for all companies
            const totalOrders = orders.length;
            const totalCompanies = Object.keys(groupedOrders).length;
            orders.forEach(order => {
                grandTotalQty += order.qty;
                grandTotalAmount += order.totalPrice;
            });

            html += `
                <div class="summary-cards">
                    <div class="summary-card">
                        <h3>Total Companies</h3>
                        <div class="value">${totalCompanies}</div>
                    </div>
                    <div class="summary-card">
                        <h3>Total Orders</h3>
                        <div class="value">${totalOrders}</div>
                    </div>
                    <div class="summary-card">
                        <h3>Total Quantity</h3>
                        <div class="value">${grandTotalQty}</div>
                    </div>
                    <div class="summary-card">
                        <h3>Total Revenue</h3>
                        <div class="value">₹${grandTotalAmount.toFixed(2)}</div>
                    </div>
                </div>
            `;

            Object.entries(groupedOrders).forEach(([companyName, companyOrders]) => {
                let companyQty = 0;
                let companyAmount = 0;

                companyOrders.forEach(order => {
                    companyQty += order.qty;
                    companyAmount += order.totalPrice;
                });

                html += `
                    <div class="company-section">
                        <div class="company-header">
                            <h2>${companyName}</h2>
                            <div class="company-stats">
                                <div>Orders: ${companyOrders.length} | Qty: ${companyQty} | Revenue: ₹${companyAmount.toFixed(2)}</div>
                            </div>
                        </div>
                        <table>
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Product</th>
                                    <th>Quantity</th>
                                    <th>Price</th>
                                    <th>Total</th>
                                    <th>Platforms</th>
                                </tr>
                            </thead>
                            <tbody>
                `;

                companyOrders.forEach(order => {
                    html += `
                        <tr>
                            <td>${moment(order.date).format('DD-MM-YYYY')}</td>
                            <td>${order.product}</td>
                            <td>${order.qty}</td>
                            <td class="amount">₹${order.price}</td>
                            <td class="amount">₹${order.totalPrice}</td>
                            <td class="platforms">${Array.isArray(order.platforms) ? order.platforms.join(', ') : order.platforms}</td>
                        </tr>
                    `;
                });

                html += `
                            <tr class="total-row">
                                <td colspan="2"><strong>${companyName} SUBTOTAL</strong></td>
                                <td><strong>${companyQty}</strong></td>
                                <td class="amount"><strong>₹${companyOrders.reduce((sum, order) => sum + order.price, 0).toFixed(2)}</strong></td>
                                <td class="amount"><strong>₹${companyAmount.toFixed(2)}</strong></td>
                                <td></td>
                            </tr>
                        </tbody>
                        </table>
                    </div>
                `;
            });

            // Grand total
            html += `
                <table style="margin-top: 20px;">
                    <tbody>
                        <tr class="grand-total-row">
                            <td colspan="2"><strong>GRAND TOTAL</strong></td>
                            <td><strong>${grandTotalQty}</strong></td>
                            <td class="amount"><strong>₹${orders.reduce((sum, order) => sum + order.price, 0).toFixed(2)}</strong></td>
                            <td class="amount"><strong>₹${grandTotalAmount.toFixed(2)}</strong></td>
                            <td></td>
                        </tr>
                    </tbody>
                </table>
            `;
        }

        html += `
                <div class="footer">
                    <p>This report was generated automatically by Prapatti Store Admin System</p>
                    <p>For any queries, please contact the administration team</p>
                </div>
            </div>
        </body>
        </html>
        `;

        return html;
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

            // Generate HTML content
            const htmlContent = module.exports.generateOrderReportHTML(orders, company, startDate, endDate);

            // Launch browser and generate PDF
            const browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            
            const page = await browser.newPage();
            await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
            
            const pdfBuffer = await page.pdf({
                format: 'A4',
                margin: {
                    top: '20mm',
                    right: '15mm',
                    bottom: '20mm',
                    left: '15mm'
                },
                printBackground: true,
                displayHeaderFooter: true,
                headerTemplate: '<div></div>',
                footerTemplate: `
                    <div style="font-size: 10px; text-align: center; width: 100%; margin: 0 15mm;">
                        <span class="pageNumber"></span> / <span class="totalPages"></span>
                    </div>
                `
            });

            await browser.close();

            // Set response headers
            const filename = company && company !== 'all' 
                ? `${company.replace(/[^a-zA-Z0-9]/g, '_')}_orders_report.pdf`
                : "all_companies_orders_report.pdf";

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
            res.setHeader('Content-Length', pdfBuffer.length);

            res.send(pdfBuffer);

        } catch (err) {
            console.error('PDF generation error:', err);
            return res.status(500).json({
                statusCode: 500,
                message: 'PDF generation failed',
                error: err.message
            });
        }
    },
};
