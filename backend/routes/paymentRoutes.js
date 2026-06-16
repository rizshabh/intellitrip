const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const auth = require('../middleware/auth');

router.post('/create-order', auth, paymentController.createOrder);
router.post('/verify-payment', auth, paymentController.verifyPayment);

module.exports = router;
