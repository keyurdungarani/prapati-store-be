const express = require('express');
const router = express.Router();
const controller = require('../controllers/product/productController');
const authUser = require('../middleware/auth');
const { uploadProductImage } = require('../middleware/upload');

// Product Stock routes. Every one is behind authUser, and every query inside
// the controller is scoped by req.user.userId, so one account can never read
// or adjust another account's stock.
//
// add/update accept multipart/form-data because they carry the image file.
// adjust/list/history/summary are plain JSON.

router.post('/add-product', authUser, uploadProductImage, controller.addProduct);
router.get('/list-products', authUser, controller.listProducts);
router.put('/update-product/:id', authUser, uploadProductImage, controller.updateProduct);
router.delete('/delete-product/:id', authUser, controller.deleteProduct);

// The daily driver: signed delta plus a reason, applied atomically.
router.post('/adjust-stock/:id', authUser, controller.adjustStock);

router.get('/audit-history', authUser, controller.getAuditHistory);

// Today's totals, for the summary cards.
router.get('/stock-summary', authUser, controller.getStockSummary);

// Day-by-day or month-by-month movement, for the chart.
router.get('/stock-series', authUser, controller.getStockSeries);

module.exports = router;
