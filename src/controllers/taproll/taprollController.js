const Taproll = require('../../models/taproll');
const moment = require('moment');
const ExcelJS = require('exceljs');
const puppeteer = require('puppeteer');

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
            return res.status(500).json({
                statusCode: 500,
                message: 'Internal Server Error',
            });
        }
    },

    // Helper function to generate HTML for PDF
    generateTaprollReportHTML: (taprolls, startDate, endDate, platform) => {
        const dateRange = startDate && endDate ? 
            `${moment(startDate).format('DD-MM-YYYY')} to ${moment(endDate).format('DD-MM-YYYY')}` : 
            'All Time';

        let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>TAPROLL REPORT</title>
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
                    background: #008080; 
                    color: white; 
                    font-weight: bold; 
                    padding: 12px 8px; 
                    text-align: left; 
                    font-size: 12px;
                }
                td { 
                    padding: 10px 8px; 
                    border-bottom: 1px solid #dee2e6; 
                    font-size: 11px;
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
                    background: linear-gradient(135deg, #008080 0%, #20b2aa 100%);
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
                    <h1>TAPROLL REPORT</h1>
                    <div class="date-range">Period: ${dateRange}</div>
                    <div class="date-range">Generated on: ${moment().format('DD-MM-YYYY HH:mm:ss')}</div>
                </div>

                <div class="filters">
                    <strong>Applied Filters:</strong> 
                    ${platform && platform !== 'all' ? `Platform: ${platform} | ` : ''}
                    Date Range: ${dateRange}
                </div>
        `;

        // Summary cards
        let totalQty = 0;
        let totalAmount = 0;
        let amazonCount = 0;
        let flipkartCount = 0;
        let meeshoCount = 0;

        taprolls.forEach(taproll => {
            totalQty += taproll.quantity;
            totalAmount += taproll.totalPrice;
            if (taproll.platform === 'Amazon Taproll') amazonCount++;
            if (taproll.platform === 'Flipkart Taproll') flipkartCount++;
            if (taproll.platform === 'Meesho Taproll') meeshoCount++;
        });

        html += `
            <div class="summary-cards">
                <div class="summary-card">
                    <h3>Total Records</h3>
                    <div class="value">${taprolls.length}</div>
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
                    <h3>Amazon</h3>
                    <div class="value">${amazonCount}</div>
                </div>
                <div class="summary-card">
                    <h3>Flipkart</h3>
                    <div class="value">${flipkartCount}</div>
                </div>
                <div class="summary-card">
                    <h3>Meesho</h3>
                    <div class="value">${meeshoCount}</div>
                </div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Quantity</th>
                        <th>Price</th>
                        <th>Total Price</th>
                        <th>Platform</th>
                    </tr>
                </thead>
                <tbody>
        `;

        taprolls.forEach(taproll => {
            html += `
                <tr>
                    <td>${moment(taproll.date).format('DD-MM-YYYY')}</td>
                    <td>${taproll.quantity}</td>
                    <td class="amount">₹${taproll.price}</td>
                    <td class="amount">₹${taproll.totalPrice}</td>
                    <td>${taproll.platform}</td>
                </tr>
            `;
        });

        html += `
                <tr class="total-row">
                    <td><strong>TOTAL</strong></td>
                    <td><strong>${totalQty}</strong></td>
                    <td class="amount"><strong>₹${taprolls.reduce((sum, t) => sum + t.price, 0).toFixed(2)}</strong></td>
                    <td class="amount"><strong>₹${totalAmount.toFixed(2)}</strong></td>
                    <td></td>
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
            const htmlContent = module.exports.generateTaprollReportHTML(taprolls, startDate, endDate, platform);

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
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'attachment; filename=taproll_report.pdf');
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