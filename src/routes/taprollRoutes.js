const express = require('express');
const router = express.Router();
const controller = require('../controllers/taproll/taprollController.js');
const authUser = require('../middleware/auth.js');

// Protected routes
router.post('/add-taproll', authUser, controller.addTaproll);
router.get('/list-taprolls', authUser, controller.listTaprolls);
router.put('/update-taproll/:id', authUser, controller.updateTaproll);
router.delete('/delete-taproll/:id', authUser, controller.deleteTaproll);
router.post('/taproll-report', authUser, controller.generateTaprollReport);

module.exports = router;