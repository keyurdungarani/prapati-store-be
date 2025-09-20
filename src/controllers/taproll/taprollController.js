const Taproll = require('../../models/taproll');
const moment = require('moment');
const ExcelJS = require('exceljs');

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
            const taproll = new Taproll({ date, quantity, price, totalPrice, platform });
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
            const taprolls = await Taproll.find();
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
            const taproll = await Taproll.findByIdAndUpdate(
                id,
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
            const taproll = await Taproll.findByIdAndDelete(id);
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
};