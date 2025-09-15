const express = require('express');
const router = express.Router();
const controller = require('../controllers/company/orderController');
const authUser = require('../middleware/auth');

// Protected routes
router.post('/add-order', authUser, controller.createOrder);
router.get('/list-orders', authUser, controller.getOrders);
router.get('/list-orders-by-company', authUser, controller.getOrdersByCompany);
router.put('/update-order/:id', authUser, controller.updateOrder);
router.delete('/delete-order/:id', authUser, controller.deleteOrder);
router.post('/generate-order-report', authUser, controller.generateOrderReport);

module.exports = router;
