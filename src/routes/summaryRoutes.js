const express = require('express');
const router = express.Router();
const controller = require('../controllers/summary/summaryController.js');
const authUser = require('../middleware/auth.js');

router.get('/account-summary', authUser, controller.accountSummary);
router.post('/account-summary', authUser, controller.createAccountSummary);
router.put('/account-summary/:id', authUser, controller.updateAccountSummary);
router.get('/account-summaries', authUser, controller.listAccountSummaries);
router.get('/account-summary/:id', authUser, controller.getAccountSummary);
router.delete('/account-summary/:id', authUser, controller.deleteAccountSummary);

module.exports = router;