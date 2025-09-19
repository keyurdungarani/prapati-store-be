const ReturnOrder = require('../../models/returnOrder');
const ExcelJS = require('exceljs');
const moment = require('moment');
const puppeteer = require('puppeteer');

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
            let filter = {};

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
                date: moment(order.date).format('DD-MM-YYYY'),
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
                const returnOrder = await ReturnOrder.findById(id);
                if (!returnOrder) {
                    return res.status(404).json({
                        statusCode: 404,
                        message: 'Return order not found',
                    });
                }

                const updatedQty = qty || returnOrder.qty;
                const updatedPrice = price || returnOrder.price;
                req.body.totalPrice = updatedQty * updatedPrice;
            }

            const returnOrder = await ReturnOrder.findByIdAndUpdate(id, req.body, { new: true, runValidators: true });

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

            const returnOrder = await ReturnOrder.findByIdAndDelete(id);

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
            return res.status(500).json({
                statusCode: 500,
                message: 'Internal Server Error',
            });
        }
    },

    // Helper function to generate HTML for PDF
    generateReturnOrderReportHTML: (returnOrders, filters, startDate, endDate) => {
        const dateRange = startDate && endDate ? 
            `${moment(startDate).format('DD-MM-YYYY')} to ${moment(endDate).format('DD-MM-YYYY')}` : 
            'All Time';

        let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>RETURN ORDERS REPORT</title>
            <style>
                body { 
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                    margin: 0; 
                    padding: 20px; 
                    background-color: #f8f9fa;
                }
                .container { 
                    max-width: 1400px; 
                    margin: 0 auto; 
                    background: white; 
                    padding: 30px; 
                    border-radius: 10px; 
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                }
                .header { 
                    text-align: center; 
                    margin-bottom: 30px; 
                    border-bottom: 3px solid #FF6B6B; 
                    padding-bottom: 20px;
                }
                .header h1 { 
                    color: #FF6B6B; 
                    margin: 0; 
                    font-size: 28px; 
                    font-weight: bold;
                }
                .header .date-range { 
                    color: #666; 
                    margin-top: 8px; 
                    font-size: 14px;
                }
                .filters { 
                    background: #f8f9fa; 
                    padding: 15px; 
                    border-radius: 8px; 
                    margin-bottom: 20px; 
                    font-size: 12px;
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
                    background: #FF6B6B; 
                    color: white; 
                    font-weight: bold; 
                    padding: 10px 6px; 
                    text-align: left; 
                    font-size: 11px;
                }
                td { 
                    padding: 8px 6px; 
                    border-bottom: 1px solid #dee2e6; 
                    font-size: 10px;
                }
                tr:nth-child(even) { 
                    background-color: #f8f9fa; 
                }
                .total-row { 
                    background: #FFC107 !important; 
                    font-weight: bold; 
                    color: #333;
                }
                .amount { 
                    text-align: right; 
                    font-weight: 500;
                }
                .summary-cards {
                    display: flex;
                    justify-content: space-around;
                    margin: 20px 0;
                    gap: 15px;
                }
                .summary-card {
                    background: linear-gradient(135deg, #FF6B6B 0%, #FF8E8E 100%);
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
                    <h1>RETURN ORDERS REPORT</h1>
                    <div class="date-range">Period: ${dateRange}</div>
                    <div class="date-range">Generated on: ${moment().format('DD-MM-YYYY HH:mm:ss')}</div>
                </div>

                <div class="filters">
                    <strong>Applied Filters:</strong> 
                    ${filters.company && filters.company !== 'all' ? `Company: ${filters.company} | ` : ''}
                    ${filters.returnReason && filters.returnReason !== 'all' ? `Return Reason: ${filters.returnReason} | ` : ''}
                    ${filters.returnBy && filters.returnBy !== 'all' ? `Return By: ${filters.returnBy} | ` : ''}
                    Date Range: ${dateRange}
                </div>
        `;

        // Summary cards
        let totalQty = 0;
        let totalAmount = 0;
        let rtoCount = 0;
        let customerCount = 0;

        returnOrders.forEach(order => {
            totalQty += order.qty;
            totalAmount += order.totalPrice;
            if (order.returnBy === 'RTO') rtoCount++;
            if (order.returnBy === 'Customer') customerCount++;
        });

        html += `
            <div class="summary-cards">
                <div class="summary-card">
                    <h3>Total Returns</h3>
                    <div class="value">${returnOrders.length}</div>
                </div>
                <div class="summary-card">
                    <h3>Total Quantity</h3>
                    <div class="value">${totalQty}</div>
                </div>
                <div class="summary-card">
                    <h3>Total Amount</h3>
                    <div class="value">₹${totalAmount.toFixed(2)}</div>
                </div>
                <div class="summary-card">
                    <h3>RTO Returns</h3>
                    <div class="value">${rtoCount}</div>
                </div>
                <div class="summary-card">
                    <h3>Customer Returns</h3>
                    <div class="value">${customerCount}</div>
                </div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Product</th>
                        <th>Qty</th>
                        <th>Price</th>
                        <th>Total</th>
                        <th>Company</th>
                        <th>Platforms</th>
                        <th>Return Reason</th>
                        <th>Return By</th>
                    </tr>
                </thead>
                <tbody>
        `;

        returnOrders.forEach(order => {
            html += `
                <tr>
                    <td>${moment(order.date).format('DD-MM-YYYY')}</td>
                    <td>${order.product}</td>
                    <td>${order.qty}</td>
                    <td class="amount">₹${order.price}</td>
                    <td class="amount">₹${order.totalPrice}</td>
                    <td>${order.company}</td>
                    <td>${Array.isArray(order.platforms) ? order.platforms.join(', ') : order.platforms}</td>
                    <td>${order.returnReason}</td>
                    <td>${order.returnBy}</td>
                </tr>
            `;
        });

        html += `
                <tr class="total-row">
                    <td colspan="2"><strong>TOTAL</strong></td>
                    <td><strong>${totalQty}</strong></td>
                    <td class="amount"><strong>₹${returnOrders.reduce((sum, order) => sum + order.price, 0).toFixed(2)}</strong></td>
                    <td class="amount"><strong>₹${totalAmount.toFixed(2)}</strong></td>
                    <td colspan="4"></td>
                </tr>
            </tbody>
            </table>

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
                date: { $gte: startDate, $lte: endDate }
            };

            if (company && company !== 'all') filter.company = company;
            if (returnReason && returnReason !== 'all') filter.returnReason = returnReason;
            if (returnBy && returnBy !== 'all') filter.returnBy = returnBy;

            // Fetch return orders based on filter
            const returnOrders = await ReturnOrder.find(filter).sort({ date: -1 });

            // Generate HTML content
            const filters = { company, returnReason, returnBy };
            const htmlContent = module.exports.generateReturnOrderReportHTML(returnOrders, filters, startDate, endDate);

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
                    right: '10mm',
                    bottom: '20mm',
                    left: '10mm'
                },
                printBackground: true,
                displayHeaderFooter: true,
                headerTemplate: '<div></div>',
                footerTemplate: `
                    <div style="font-size: 10px; text-align: center; width: 100%; margin: 0 10mm;">
                        <span class="pageNumber"></span> / <span class="totalPages"></span>
                    </div>
                `
            });

            await browser.close();

            // Set response headers
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'attachment; filename=return_orders_report.pdf');
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
