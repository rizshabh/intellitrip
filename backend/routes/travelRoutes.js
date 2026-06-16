const express = require('express');
const router = express.Router();
const travelController = require('../controllers/travelController');
const auth = require('../middleware/auth');

router.get('/flights/search', auth, travelController.searchFlights);
router.get('/flights/airports', auth, travelController.searchAirports);
router.get('/locales', auth, travelController.getLocales);

module.exports = router;
