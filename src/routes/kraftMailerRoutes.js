const express = require('express');
const router = express.Router();
const controller = require('../controllers/kraftMailer/kraftMailerController.js');
const authUser = require('../middleware/auth.js');

// Protected routes
router.post('/add-kraftmailer', authUser, controller.addKraftMailer);
router.get('/list-kraftmailers', authUser, controller.listKraftMailers);
router.put('/update-kraftmailer/:id', authUser, controller.updateKraftMailer);
router.delete('/delete-kraftmailer/:id', authUser, controller.deleteKraftMailer);
router.post('/kraftmailer-report', authUser, controller.generateKraftMailerReport);

module.exports = router;
