const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const dashboardController = require('../controllers/dashboardController');

router.get('/', auth, dashboardController.getDashboardStats);

module.exports = router;
