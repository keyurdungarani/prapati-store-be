const KraftMailer = require('../../models/kraftMailer');
const moment = require('moment');
const ExcelJS = require('exceljs');
const { renderPdf, sendPdf, sendPdfError } = require('../../utils/pdfService');
const layout = require('../../utils/reportLayout');

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

			const kraftMailer = new KraftMailer({ user: req.user.userId, date, quantity, price, totalPrice, size });
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
			const kraftMailers = await KraftMailer.find({ user: req.user.userId });
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

			const kraftMailer = await KraftMailer.findOneAndUpdate(
				{ _id: id, user: req.user.userId },
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
			const kraftMailer = await KraftMailer.findOneAndDelete({ _id: id, user: req.user.userId });
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
				user: req.user.userId,
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
			// The workbook streams straight into the response, so once it has
			// started there are no headers left to replace with a JSON error.
			if (res.headersSent) return res.destroy();

			console.error(err);
			return res.status(500).json({
				statusCode: 500,
				message: 'Internal Server Error',
			});
		}
	},

	// Build the pdfmake document definition for the kraft mailer report
	buildKraftMailerReportDocument: (kraftMailers, startDate, endDate) => {
		const dateRange = layout.dateRangeLabel(startDate, endDate);
		const accent = layout.ACCENT.kraftMailer;

		const sum = (key) => kraftMailers.reduce((acc, k) => acc + (Number(k[key]) || 0), 0);

		const columns = [
			{ header: 'Date', width: 80 },
			{ header: 'Quantity', width: 70, align: 'center' },
			{ header: 'Price', width: 85, align: 'right' },
			{ header: 'Total Price', width: 95, align: 'right' },
			{ header: 'Size (WxHxD)', width: '*' },
		];

		const rows = kraftMailers.map((kraftMailer) => {
			const size = kraftMailer.size
				? `${kraftMailer.size.width || ''} x ${kraftMailer.size.height || ''} x ${kraftMailer.size.depth || ''}`
				: '';

			return [
				layout.formatDate(kraftMailer.date),
				layout.count(kraftMailer.quantity),
				layout.money(kraftMailer.price),
				layout.money(kraftMailer.totalPrice),
				size,
			];
		});

		const content = layout.reportHeader('KRAFT MAILER REPORT', accent, [
			`Period: ${dateRange}`,
			`Generated on: ${moment().format('DD-MM-YYYY HH:mm:ss')}`,
		]);

		content.push(layout.summaryCards([
			{ label: 'Total Records', value: String(kraftMailers.length) },
			{ label: 'Total Quantity', value: layout.count(sum('quantity')) },
			{ label: 'Total Amount', value: layout.money(sum('totalPrice')) },
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

		return layout.documentShell({ title: 'KRAFT MAILER REPORT', content });
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
				user: req.user.userId,
				date: { $gte: startDate, $lte: endDate }
			}).sort({ date: -1 });

			// Generate HTML content
			const docDefinition = module.exports.buildKraftMailerReportDocument(kraftMailers, startDate, endDate);

			const pdfBuffer = await renderPdf(docDefinition);

			sendPdf(res, pdfBuffer, 'kraft_mailer_report.pdf');

		} catch (err) {
			return sendPdfError(res, err, 'Kraft mailer report PDF');
		}
	},
};