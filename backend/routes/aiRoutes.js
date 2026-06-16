const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const aiController = require('../controllers/aiController');

// Health check
router.get('/health', (req, res) => res.json({ status: 'ok' }));

// All AI routes should be protected, or at least some
router.post('/predict-cost', auth, aiController.predictTripCost); // Protected for user-specific currency
router.get('/season', aiController.getSeasonSuggestions); // Public
router.get('/tips', auth, aiController.getSmartTips); // Protected (personalized)
router.get('/weather', aiController.getDestinationWeather); // Public
router.get('/recommendations', aiController.getClimateRecommendations); // Public - New
router.get('/audit', auth, aiController.getTripAudit); // Protected - Premium

router.post('/itinerary', auth, aiController.generateTripItinerary); // Protected - Premium Planner
router.post('/full-plan', auth, aiController.generateFullPlan); // Protected - High Intelligence Full Plan
router.post('/optimize-schedule', auth, aiController.optimizeSchedule); // Protected - Auto time adjustment
router.post('/voice', auth, aiController.processVoiceCommand); // Protected - Intelligent Assistant

// Saved Tips Management
router.post('/tips/save', auth, aiController.saveAITip);
router.get('/tips/saved', auth, aiController.getSavedAITips);
router.post('/tips/remove', auth, aiController.removeSavedAITip);

module.exports = router;
