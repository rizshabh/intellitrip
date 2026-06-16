const express = require('express');
const router = express.Router();
const tripController = require('../controllers/tripController');
const auth = require('../middleware/auth');

router.get('/', auth, tripController.getTrips);
router.post('/', auth, tripController.createTrip);
router.put('/:id', auth, tripController.updateTrip);
router.delete('/:id', auth, tripController.deleteTrip);

router.post('/:id/collaborators', auth, tripController.addCollaborator);
router.delete('/:id/members/:userId', auth, tripController.removeMember);
router.post('/invite/respond', auth, tripController.respondToInvite);
router.get('/:id/members', auth, tripController.getTripMembers);

router.get('/:id/itinerary', auth, tripController.getItinerary);
router.post('/:id/itinerary', auth, tripController.addItineraryItem);
router.put('/:id/itinerary/:itemId', auth, tripController.updateItineraryItem);
router.delete('/:id/itinerary/:itemId', auth, tripController.deleteItineraryItem);
router.delete('/:id/itinerary', auth, tripController.clearItinerary);

module.exports = router;
