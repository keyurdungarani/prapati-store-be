const express = require('express');
const router = express.Router();
const controller = require('../controllers/company/returnOrderController');
const authUser = require('../middleware/auth');

// Protected routes
router.post('/add-return-order', authUser, controller.createReturnOrder);
router.get('/list-return-orders', authUser, controller.getReturnOrders);
router.put('/update-return-order/:id', authUser, controller.updateReturnOrder);
router.delete('/delete-return-order/:id', authUser, controller.deleteReturnOrder);
router.post('/generate-return-order-report', authUser, controller.generateReturnOrderReport);
router.post('/generate-return-order-report-pdf', authUser, controller.generateReturnOrderReportPDF);

module.exports = router;
