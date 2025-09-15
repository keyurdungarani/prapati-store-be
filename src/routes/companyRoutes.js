const express = require('express');
const router = express.Router();
const controller = require('../controllers/company/companyController.js');
const authUser = require('../middleware/auth.js');

// Protected routes
router.post('/add-company', authUser, controller.addCompany);
router.get('/list-companies', authUser, controller.listCompanies);
router.put('/update-company/:id', authUser, controller.updateCompany);
router.delete('/delete-company/:id', authUser, controller.deleteCompany);

module.exports = router;
