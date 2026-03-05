const order = require('../../models/order');
const returnOrder = require('../../models/returnOrder');
const kraftMailer = require('../../models/kraftMailer');
const taproll = require('../../models/taproll');
const accountSummaryModel = require('../../models/accountSummary');
const {Types} = require('mongoose');

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

        const moment = require('moment');
        const puppeteer = require('puppeteer');

        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Account Summaries Report</title>
            <style>
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 20px; background-color: #f8f9fa; }
                .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                .header { text-align: center; margin-bottom: 30px; border-bottom: 3px solid #008080; padding-bottom: 20px; }
                h1 { color: #008080; margin: 0; font-size: 28px; }
                .report-info { display: flex; justify-content: space-between; margin-bottom: 25px; color: #555; font-size: 14px; }
                .summary-card { border: 1px solid #ddd; border-radius: 8px; margin-bottom: 40px; overflow: hidden; page-break-inside: avoid; }
                .card-header { bg-color: #008080; color: white; padding: 12px 20px; font-weight: bold; display: flex; justify-content: space-between; background-color: #008080; }
                .card-body { padding: 20px; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                th, td { border: 1px solid #e0e0e0; padding: 12px 15px; text-align: left; }
                th { background-color: #f1f8f8; color: #008080; font-weight: 600; width: 60%; }
                td { color: #333; font-weight: 500; }
                .amount { text-align: right; font-family: 'Courier New', Courier, monospace; }
                .net-income { margin-top: 15px; padding: 15px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; }
                .positive { background-color: #e8f5e9; border: 1px solid #c8e6c9; color: #2e7d32; }
                .negative { background-color: #ffebee; border: 1px solid #ffcdd2; color: #c62828; }
                .income-label { font-weight: bold; font-size: 18px; }
                .income-value { font-size: 20px; font-weight: 800; }
                .footer { text-align: center; margin-top: 40px; color: #888; font-size: 12px; border-top: 1px solid #eee; padding-top: 20px; }
                .badge { padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; text-transform: uppercase; }
                .badge-profit { background: #c8e6c9; color: #2e7d32; }
                .badge-loss { background: #ffcdd2; color: #c62828; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Prapatti Store</h1>
                    <p style="color: #666; margin-top: 5px;">Account Summaries Report</p>
                </div>
                
                <div class="report-info">
                    <div>Generated on: ${moment().format('DD MMMM YYYY, h:mm A')}</div>
                    <div>Statements Count: ${summaries.length}</div>
                </div>

                ${summaries.map(summary => `
                    <div class="summary-card">
                        <div class="card-header">
                            <span>Period: ${moment(summary.fromDate).format('DD MMM YYYY')} - ${moment(summary.toDate).format('DD MMM YYYY')}</span>
                            <span class="badge ${summary.netIncome >= 0 ? 'badge-profit' : 'badge-loss'}">
                                ${summary.netIncome >= 0 ? 'Profit' : 'Loss'}
                            </span>
                        </div>
                        <div class="card-body">
                            <table>
                                <tr><th>Orders Total</th><td class="amount">₹${summary.orders.toFixed(2)}</td></tr>
                                <tr><th>Kraft Mailers</th><td class="amount">₹${summary.kraftMailers.toFixed(2)}</td></tr>
                                <tr><th>Taprolls</th><td class="amount">₹${summary.taprolls.toFixed(2)}</td></tr>
                                <tr><th>Office Expenses</th><td class="amount">₹${summary.officeExpenses.toFixed(2)}</td></tr>
                                <tr><th>Product Stock (Credit)</th><td class="amount">₹${summary.productStock.toFixed(2)}</td></tr>
                                <tr><th>Return Damaged Amount</th><td class="amount">₹${summary.returnDamagedOrders.toFixed(2)}</td></tr>
                                <tr><th>Return Different Amount</th><td class="amount">₹${summary.returnDifferentOrders.toFixed(2)}</td></tr>
                                <tr><th>Total Received Bank Payment</th><td class="amount">₹${summary.totalReceivedPayment.toFixed(2)}</td></tr>
                                <tr><th>Pending Payment</th><td class="amount">₹${summary.pendingPayment.toFixed(2)}</td></tr>
                            </table>
                            
                            <div class="net-income ${summary.netIncome >= 0 ? 'positive' : 'negative'}">
                                <span class="income-label">Net Income</span>
                                <span class="income-value">₹${summary.netIncome.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>
                `).join('')}

                <div class="footer">
                    <p>© ${moment().format('YYYY')} Prapatti Store. All rights reserved.</p>
                    <p>This is a computer-generated document.</p>
                </div>
            </div>
        </body>
        </html>
        `;

        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' }
        });

        await browser.close();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=account_summaries_report.pdf');
        res.send(pdfBuffer);

    } catch (error) {
        console.error('PDF Generation Error:', error);
        return res.status(500).json({
            statusCode: 500,
            message: 'Failed to generate PDF',
            error: error.message,
        });
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