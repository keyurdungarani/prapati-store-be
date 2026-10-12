const express = require('express');
const router = express.Router();
const controller = require('../controllers/auth/userController');
const authUser = require('../middleware/auth');

router.post('/register', controller.register);
router.post('/login', controller.login);
router.get('/profile', authUser, controller.getProfile);
router.put('/change-password', authUser, controller.changePassword);

module.exports = router;
