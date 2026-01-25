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
        const returnOrders = await returnOrder.aggregate([
            { $match: { user: new Types.ObjectId(req.user.userId), date: { $gte: new Date(fromDate), $lte: new Date(toDate) }, returnReason: {$nin: ['OK']} } },
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
            returnOrders: returnOrders[0]?.totalPrice || 0,
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
        const { fromDate, toDate, orders, returnOrders, kraftMailers, taprolls, totalReceivedPayment, officeExpenses } = req.body;
        
        // Calculate net income
        const netIncome = totalReceivedPayment - (orders + kraftMailers + taprolls + returnOrders + officeExpenses);
        
        const accountSummary = new accountSummaryModel({
            user: req.user.userId,
            fromDate: new Date(fromDate),
            toDate: new Date(toDate),
            orders: parseFloat(orders) || 0,
            returnOrders: parseFloat(returnOrders) || 0,
            kraftMailers: parseFloat(kraftMailers) || 0,
            taprolls: parseFloat(taprolls) || 0,
            totalReceivedPayment: parseFloat(totalReceivedPayment) || 0,
            officeExpenses: parseFloat(officeExpenses) || 0,
            netIncome: netIncome
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
        const { fromDate, toDate, orders, returnOrders, kraftMailers, taprolls, totalReceivedPayment, officeExpenses } = req.body;
        
        // Calculate net income
        const netIncome = totalReceivedPayment - (orders + kraftMailers + taprolls + returnOrders + officeExpenses);
        
        const accountSummary = await accountSummaryModel.findOneAndUpdate(
            { _id: id, user: req.user.userId },
            {
                fromDate: new Date(fromDate),
                toDate: new Date(toDate),
                orders: parseFloat(orders) || 0,
                returnOrders: parseFloat(returnOrders) || 0,
                kraftMailers: parseFloat(kraftMailers) || 0,
                taprolls: parseFloat(taprolls) || 0,
                totalReceivedPayment: parseFloat(totalReceivedPayment) || 0,
                officeExpenses: parseFloat(officeExpenses) || 0,
                netIncome: netIncome
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

module.exports = { 
    accountSummary,
    createAccountSummary,
    updateAccountSummary,
    listAccountSummaries,
    getAccountSummary,
    deleteAccountSummary
};