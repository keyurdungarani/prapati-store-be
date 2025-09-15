const Order = require('../../models/order');
const ExcelJS = require('exceljs');
const moment = require('moment');

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

            // Create and save the order
            const order = new Order({
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
            let filter = {};

            if (company) filter.company = company;
            if (platforms) filter.platforms = platforms;
            if (startDate && endDate) {
                filter.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
            }

            const orders = await Order.find(filter);

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
                const order = await Order.findById(id);
                if (!order) {
                    return res.status(404).json({
                        statusCode: 404,
                        message: 'Order not found',
                    });
                }

                const updatedQty = qty || order.qty;
                const updatedPrice = price || order.price;
                req.body.totalPrice = updatedQty * updatedPrice;
            }

            const order = await Order.findByIdAndUpdate(id, req.body, { new: true, runValidators: true });

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

            const order = await Order.findByIdAndDelete(id);

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
            let filter = {};

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
};
