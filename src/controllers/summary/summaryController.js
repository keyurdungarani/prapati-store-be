const order = require('../../models/order');
const returnOrder = require('../../models/returnOrder');
const kraftMailer = require('../../models/kraftMailer');
const taproll = require('../../models/taproll');
const accountSummaryModel = require('../../models/accountSummary');
const {Types} = require('mongoose');
const { renderPdf, sendPdf, sendPdfError } = require('../../utils/pdfService');
const layout = require('../../utils/reportLayout');
const moment = require('moment');

const accountSummary = async (req, res) => {
    try {
        const {fromDate, toDate} = req.query;
    // monthly summary of totalPrice of all each below models saparately
        const orders = await order.aggregate([
            { $match: { user: new Types.ObjectId(req.user.userId), date: { $gte: new Date(fromDate), $lte: new Date(toDate) } } },
            { $group: { _id: null, totalPrice: { $sum: '$totalPrice' } } }
        ]);
        const returnDamagedOrders = await returnOrder.aggregate([
            { $match: { user: new Types.ObjectId(req.user.userId), date: { $gte: new Date(fromDate), $lte: new Date(toDate) }, returnReason: 'Damaged' } },
            { $group: { _id: null, totalPrice: { $sum: '$totalPrice' } } }
        ]);
        const returnDifferentOrders = await returnOrder.aggregate([
            { $match: { user: new Types.ObjectId(req.user.userId), date: { $gte: new Date(fromDate), $lte: new Date(toDate) }, returnReason: 'Different' } },
            { $group: { _id: null, totalPrice: { $sum: '$totalPrice' } } }
        ]);
        const kraftMailers = await kraftMailer.aggregate([
            { $match: { user: new Types.ObjectId(req.user.userId), date: { $gte: new Date(fromDate), $lte: new Date(toDate) } } },
            { $group: { _id: null, totalPrice: { $sum: '$totalPrice' } } }
        ]);
        const taprolls = await taproll.aggregate([
            { $match: { user: new Types.ObjectId(req.user.userId), date: { $gte: new Date(fromDate), $lte: new Date(toDate) } } },
            { $group: { _id: null, totalPrice: { $sum: '$totalPrice' } } }
        ]);
    
        const summary = {
            orders: orders[0]?.totalPrice || 0,
            returnDamagedOrders: returnDamagedOrders[0]?.totalPrice || 0,
            returnDifferentOrders: returnDifferentOrders[0]?.totalPrice || 0,
            kraftMailers: kraftMailers[0]?.totalPrice || 0,
            taprolls: taprolls[0]?.totalPrice || 0,
        }
    
        return res.status(200).json({
            statusCode: 200,
            message: 'Account summary retrieved successfully',
            data: summary,
        });
    } catch (error) {
        return res.status(500).json({
            statusCode: 500,
            message: 'Internal Server Error',
            error: error.message,
        });
    }
}

const createAccountSummary = async (req, res) => {
    try {
        const { fromDate, toDate, orders, returnDamagedOrders, returnDifferentOrders, productStock, kraftMailers, taprolls, totalReceivedPayment, officeExpenses, pendingPayment, netIncome = 0 } = req.body;
        
        const accountSummary = new accountSummaryModel({
            user: req.user.userId,
            fromDate: new Date(fromDate),
            toDate: new Date(toDate),
            orders: parseFloat(orders) || 0,
            returnDamagedOrders: parseFloat(returnDamagedOrders) || 0,
            returnDifferentOrders: parseFloat(returnDifferentOrders) || 0,
            productStock: parseFloat(productStock) || 0,
            kraftMailers: parseFloat(kraftMailers) || 0,
            taprolls: parseFloat(taprolls) || 0,
            totalReceivedPayment: parseFloat(totalReceivedPayment) || 0,
            officeExpenses: parseFloat(officeExpenses) || 0,
            pendingPayment: parseFloat(pendingPayment) || 0,
            netIncome: parseFloat(netIncome) || 0
        });
        
        await accountSummary.save();
        
        return res.status(201).json({
            statusCode: 201,
            message: 'Account summary created successfully',
            data: accountSummary,
        });
    } catch (error) {
        return res.status(500).json({
            statusCode: 500,
            message: 'Internal Server Error',
            error: error.message,
        });
    }
};

const updateAccountSummary = async (req, res) => {
    try {
        const { id } = req.params;
        const { fromDate, toDate, orders, returnDamagedOrders, returnDifferentOrders, productStock, kraftMailers, taprolls, totalReceivedPayment, officeExpenses, pendingPayment, netIncome = 0 } = req.body;
        
        const accountSummary = await accountSummaryModel.findOneAndUpdate(
            { _id: id, user: req.user.userId },
            {
                fromDate: new Date(fromDate),
                toDate: new Date(toDate),
                orders: parseFloat(orders) || 0,
                returnDamagedOrders: parseFloat(returnDamagedOrders) || 0,
                returnDifferentOrders: parseFloat(returnDifferentOrders) || 0,
                productStock: parseFloat(productStock) || 0,
                kraftMailers: parseFloat(kraftMailers) || 0,
                taprolls: parseFloat(taprolls) || 0,
                totalReceivedPayment: parseFloat(totalReceivedPayment) || 0,
                officeExpenses: parseFloat(officeExpenses) || 0,
                pendingPayment: parseFloat(pendingPayment) || 0,
                netIncome: parseFloat(netIncome) || 0
            },
            { new: true, runValidators: true }
        );
        
        if (!accountSummary) {
            return res.status(404).json({
                statusCode: 404,
                message: 'Account summary not found',
            });
        }
        
        return res.status(200).json({
            statusCode: 200,
            message: 'Account summary updated successfully',
            data: accountSummary,
        });
    } catch (error) {
        return res.status(500).json({
            statusCode: 500,
            message: 'Internal Server Error',
            error: error.message,
        });
    }
};

const listAccountSummaries = async (req, res) => {
    try {
        const accountSummaries = await accountSummaryModel.find({ user: req.user.userId })
            .sort({ createdAt: -1 });
        
        return res.status(200).json({
            statusCode: 200,
            message: 'Account summaries retrieved successfully',
            data: accountSummaries,
        });
    } catch (error) {
        return res.status(500).json({
            statusCode: 500,
            message: 'Internal Server Error',
            error: error.message,
        });
    }
};

const getAccountSummary = async (req, res) => {
    try {
        const { id } = req.params;
        
        const accountSummary = await accountSummaryModel.findOne({
            _id: id,
            user: req.user.userId
        });
        
        if (!accountSummary) {
            return res.status(404).json({
                statusCode: 404,
                message: 'Account summary not found',
            });
        }
        
        return res.status(200).json({
            statusCode: 200,
            message: 'Account summary retrieved successfully',
            data: accountSummary,
        });
    } catch (error) {
        return res.status(500).json({
            statusCode: 500,
            message: 'Internal Server Error',
            error: error.message,
        });
    }
};

const deleteAccountSummary = async (req, res) => {
    try {
        const { id } = req.params;
        const accountSummary = await accountSummaryModel.findByIdAndDelete(new Types.ObjectId(id));
        if (!accountSummary) {
            return res.status(404).json({
                statusCode: 404,
                message: 'Account summary not found',
            });
        }
        return res.status(200).json({
            statusCode: 200,
            message: 'Account summary deleted successfully',
            data: accountSummary,
        });
    } catch (error) {
        return res.status(500).json({
            statusCode: 500,
            message: 'Internal Server Error',
            error: error.message,
        });
    }
};

const downloadAccountSummary = async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({
                statusCode: 400,
                message: 'Account summary IDs are required',
            });
        }

        const summaries = await accountSummaryModel.find({
            _id: { $in: ids },
            user: req.user.userId
        }).sort({ fromDate: 1 });

        if (summaries.length === 0) {
            return res.status(404).json({
                statusCode: 404,
                message: 'No account summaries found',
            });
        }

        const accent = layout.ACCENT.summary;

        const content = layout.reportHeader('Prapatti Store', accent, [
            'Account Summaries Report',
            `Generated on: ${moment().format('DD MMMM YYYY, h:mm A')}`,
            `Statements Count: ${summaries.length}`,
        ]);

        // One card per statement, each listing the same nine figures the HTML
        // version showed, followed by the net income line.
        summaries.forEach((summary) => {
            const isProfit = Number(summary.netIncome) >= 0;
            const period = `${layout.formatDate(summary.fromDate)}  to  ${layout.formatDate(summary.toDate)}`;

            const figures = [
                ['Orders Total', layout.money(summary.orders)],
                ['Kraft Mailers', layout.money(summary.kraftMailers)],
                ['Taprolls', layout.money(summary.taprolls)],
                ['Office Expenses', layout.money(summary.officeExpenses)],
                ['Product Stock (Credit)', '-' + layout.money(summary.productStock)],
                ['Total Received Bank Payment', layout.money(summary.totalReceivedPayment)],
                ['Pending Payment', layout.money(summary.pendingPayment)],
                ['Return Damaged Amount', layout.money(summary.returnDamagedOrders)],
                ['Return Different Amount', layout.money(summary.returnDifferentOrders)],
            ];

            content.push({
                table: {
                    widths: ['*', 110],
                    body: [
                        [
                            { text: `Period: ${period}`, bold: true, fontSize: 9, color: '#ffffff' },
                            {
                                text: isProfit ? 'PROFIT' : 'LOSS',
                                bold: true,
                                fontSize: 8,
                                alignment: 'right',
                                color: '#ffffff',
                            },
                        ],
                        ...figures.map(([label, value]) => [
                            { text: label, fontSize: 8.5 },
                            { text: value, fontSize: 8.5, alignment: 'right' },
                        ]),
                        [
                            { text: 'NET INCOME', bold: true, fontSize: 10 },
                            {
                                text: layout.money(summary.netIncome),
                                bold: true,
                                fontSize: 10,
                                alignment: 'right',
                                color: isProfit ? '#2e7d32' : '#c62828',
                            },
                        ],
                    ],
                },
                layout: {
                    hLineWidth: (i, node) => (i === 1 || i === node.table.body.length - 1 ? 0.8 : 0.4),
                    vLineWidth: () => 0,
                    hLineColor: () => '#dee2e6',
                    fillColor: (rowIndex, node) => {
                        if (rowIndex === 0) return isProfit ? '#2e7d32' : '#c62828';
                        if (rowIndex === node.table.body.length - 1) return '#eef1f4';
                        return rowIndex % 2 === 0 ? '#f7f8fa' : null;
                    },
                    paddingLeft: () => 9,
                    paddingRight: () => 9,
                    paddingTop: () => 5,
                    paddingBottom: () => 5,
                },
                margin: [0, 0, 0, 14],
                unbreakable: true,
            });
        });

        content.push({
            text: `\u00A9 ${moment().format('YYYY')} Prapatti Store. All rights reserved.`,
            fontSize: 8,
            color: '#888888',
            alignment: 'center',
            margin: [0, 18, 0, 0],
        });

        const docDefinition = layout.documentShell({ title: 'Account Summaries Report', content });
        const pdfBuffer = await renderPdf(docDefinition);

        sendPdf(res, pdfBuffer, 'account_summaries_report.pdf');

    } catch (error) {
        return sendPdfError(res, error, 'Account summary report PDF');
    }
};

module.exports = { 
    accountSummary,
    createAccountSummary,
    updateAccountSummary,
    listAccountSummaries,
    getAccountSummary,
    deleteAccountSummary,
    downloadAccountSummary
};