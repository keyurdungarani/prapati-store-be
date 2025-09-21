const KraftMailer = require('../../models/kraftMailer');
const moment = require('moment');
const ExcelJS = require('exceljs');
const puppeteer = require('puppeteer');

module.exports = {
	// Add a new kraftMailer
	addKraftMailer: async (req, res) => {
		try {
			const { date, quantity, price, size } = req.body;

			// Validate input
			if (!date || !quantity || !price || !size) {
				return res.status(400).json({
					statusCode: 400,
					message: 'All fields are required',
				});
			}

			const totalPrice = quantity * price;

			const kraftMailer = new KraftMailer({ date, quantity, price, totalPrice, size });
			await kraftMailer.save();

			return res.status(201).json({
				statusCode: 201,
				message: 'KraftMailer added successfully',
				data: kraftMailer,
			});

		} catch (err) {
			return res.status(500).json({
				statusCode: 500,
				message: 'Internal Server Error',
			});
		}
	},

	// List all kraftMailers
	listKraftMailers: async (req, res) => {
		try {
			const kraftMailers = await KraftMailer.find();
			const formattedKraftMailers = kraftMailers.map(kraftMailer => ({
				...kraftMailer._doc,
				date: moment(kraftMailer.date).format('DD-MM-YYYY'),
			}));
			return res.status(200).json({
				statusCode: 200,
				message: 'KraftMailers retrieved successfully',
				data: formattedKraftMailers,
			});

		} catch (err) {
			return res.status(500).json({
				statusCode: 500,
				message: 'Internal Server Error',
			});
		}
	},

	// Update a kraftMailer by ID
	updateKraftMailer: async (req, res) => {
		try {
			const { id } = req.params;
			const { date, quantity, price, size } = req.body;

			if (!date && !quantity && !price && !size) {
				return res.status(400).json({
					statusCode: 400,
					message: 'At least one field is required to update',
				});
			}

			let updateFields = { date, quantity, price, size };

			// Only calculate totalPrice if both quantity and price are provided
			if (typeof quantity !== 'undefined' && typeof price !== 'undefined') {
				updateFields.totalPrice = quantity * price;
			}

			const kraftMailer = await KraftMailer.findByIdAndUpdate(
				id,
				updateFields,
				{ new: true, runValidators: true }
			);

			if (!kraftMailer) {
				return res.status(404).json({
					statusCode: 404,
					message: 'KraftMailer not found',
				});
			}

			return res.status(200).json({
				statusCode: 200,
				message: 'KraftMailer updated successfully',
				data: kraftMailer,
			});

		} catch (err) {
			return res.status(500).json({
				statusCode: 500,
				message: 'Internal Server Error',
			});
		}
	},

	// Delete a kraftMailer by ID
	deleteKraftMailer: async (req, res) => {
		try {
			const { id } = req.params;
			const kraftMailer = await KraftMailer.findByIdAndDelete(id);
			if (!kraftMailer) {
				return res.status(404).json({
					statusCode: 404,
					message: 'KraftMailer not found',
				});
			}
			return res.status(200).json({
				statusCode: 200,
				message: 'KraftMailer deleted successfully',
			});

		} catch (err) {
			return res.status(500).json({
				statusCode: 500,
				message: 'Internal Server Error',
			});
		}
	},

	// Generate KraftMailer Excel report
	generateKraftMailerReport: async (req, res) => {
		try {
			const body = req.body || {};
			let { startDate, endDate } = body;

			// Default: current month
			if (!startDate || !endDate) {
				const now = new Date();
				startDate = new Date(now.getFullYear(), now.getMonth(), 1);
				endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
			} else {
				startDate = new Date(startDate);
				endDate = new Date(endDate);
			}

			// Fetch kraftMailers in date range
			const kraftMailers = await KraftMailer.find({
				date: { $gte: startDate, $lte: endDate }
			});

			// Create workbook & worksheet
			const workbook = new ExcelJS.Workbook();
			const worksheet = workbook.addWorksheet('KRAFT MAILER REPORT');

			worksheet.columns = [
				{ header: "DATE", key: "date", width: 20 },
				{ header: "QUANTITY", key: "quantity", width: 15 },
				{ header: "PRICE", key: "price", width: 15 },
				{ header: "TOTAL PRICE", key: "totalPrice", width: 20 },
				{ header: "SIZE (WxHxD)", key: "size", width: 25 },
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

			function sizeValue(val) {
				return typeof val !== 'undefined' && val !== null ? val : '';
			}

			kraftMailers.forEach(kraftMailer => {
				const size = kraftMailer.size
					? `${sizeValue(kraftMailer.size.width)}x${sizeValue(kraftMailer.size.height)}${kraftMailer.size.depth ? 'x' + sizeValue(kraftMailer.size.depth) : ''}`
					: '';
				worksheet.addRow({
					date: moment(kraftMailer.date).format('DD-MM-YYYY'),
					quantity: kraftMailer.quantity,
					price: kraftMailer.price,
					totalPrice: kraftMailer.totalPrice,
					size,
				}).eachCell((cell) => {
					cell.alignment = { horizontal: "center", vertical: "middle" };
				});

				totalQtySum += kraftMailer.quantity;
				totalPriceSum += kraftMailer.price;
				totalOverallPriceSum += kraftMailer.totalPrice;
			});

			worksheet.addRow({});

			const totalRow = worksheet.addRow({
				date: "TOTAL",
				quantity: totalQtySum,
				price: totalPriceSum.toFixed(2),
				totalPrice: totalOverallPriceSum.toFixed(2),
				size: "",
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
				"attachment; filename=kraft_mailer_report.xlsx"
			);
			await workbook.xlsx.write(res);
			res.end();

		} catch (err) {
			console.error(err);
			return res.status(500).json({
				statusCode: 500,
				message: 'Internal Server Error',
			});
		}
	},

	// Helper function to generate HTML for PDF
	generateKraftMailerReportHTML: (kraftMailers, startDate, endDate) => {
		const dateRange = startDate && endDate ? 
			`${moment(startDate).format('DD-MM-YYYY')} to ${moment(endDate).format('DD-MM-YYYY')}` : 
			'All Time';

		let html = `
		<!DOCTYPE html>
		<html>
		<head>
			<meta charset="UTF-8">
			<title>KRAFT MAILER REPORT</title>
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
					<h1>KRAFT MAILER REPORT</h1>
					<div class="date-range">Period: ${dateRange}</div>
					<div class="date-range">Generated on: ${moment().format('DD-MM-YYYY HH:mm:ss')}</div>
				</div>
		`;

		// Summary cards
		let totalQty = 0;
		let totalAmount = 0;

		kraftMailers.forEach(kraftMailer => {
			totalQty += kraftMailer.quantity;
			totalAmount += kraftMailer.totalPrice;
		});

		html += `
			<div class="summary-cards">
				<div class="summary-card">
					<h3>Total Records</h3>
					<div class="value">${kraftMailers.length}</div>
				</div>
				<div class="summary-card">
					<h3>Total Quantity</h3>
					<div class="value">${totalQty}</div>
				</div>
				<div class="summary-card">
					<h3>Total Amount</h3>
					<div class="value">₹${totalAmount.toFixed(2)}</div>
				</div>
			</div>

			<table>
				<thead>
					<tr>
						<th>Date</th>
						<th>Quantity</th>
						<th>Price</th>
						<th>Total Price</th>
						<th>Size (WxHxD)</th>
					</tr>
				</thead>
				<tbody>
		`;

		kraftMailers.forEach(kraftMailer => {
			const size = kraftMailer.size
				? `${kraftMailer.size.width || ''} x ${kraftMailer.size.height || ''} x ${kraftMailer.size.depth || ''}`
				: '';
			
			html += `
				<tr>
					<td>${moment(kraftMailer.date).format('DD-MM-YYYY')}</td>
					<td>${kraftMailer.quantity}</td>
					<td class="amount">₹${kraftMailer.price}</td>
					<td class="amount">₹${kraftMailer.totalPrice}</td>
					<td>${size}</td>
				</tr>
			`;
		});

		html += `
				<tr class="total-row">
					<td><strong>TOTAL</strong></td>
					<td><strong>${totalQty}</strong></td>
					<td class="amount"><strong>₹${kraftMailers.reduce((sum, k) => sum + k.price, 0).toFixed(2)}</strong></td>
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
	generateKraftMailerReportPDF: async (req, res) => {
		try {
			let { startDate, endDate } = req.body;

			// Default: current month
			if (!startDate || !endDate) {
				const now = new Date();
				startDate = new Date(now.getFullYear(), now.getMonth(), 1);
				endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
			} else {
				startDate = new Date(startDate);
				endDate = new Date(endDate);
			}

			// Fetch kraft mailers based on filter
			const kraftMailers = await KraftMailer.find({
				date: { $gte: startDate, $lte: endDate }
			}).sort({ date: -1 });

			// Generate HTML content
			const htmlContent = module.exports.generateKraftMailerReportHTML(kraftMailers, startDate, endDate);

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
			res.setHeader('Content-Disposition', 'attachment; filename=kraft_mailer_report.pdf');
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