const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/auth');

// Public routes
router.post('/register', authController.register);
router.post('/verify-signup-otp', authController.verifySignupOTP);
router.post('/login', authController.login);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.post('/verify-reset-otp', authController.verifyResetOTP);

const upload = require('../middleware/uploadMiddleware');

// Protected routes
router.get('/profile', authMiddleware, authController.getProfile);
router.put('/profile', authMiddleware, authController.updateProfile);
router.post('/upload-picture', authMiddleware, upload.single('profile_picture'), authController.uploadProfilePicture);

router.post('/request-password-change', authMiddleware, authController.requestPasswordChange);
router.post('/verify-password-change', authMiddleware, authController.verifyPasswordChange);
router.post('/request-account-deletion', authMiddleware, authController.requestAccountDeletion);
router.post('/confirm-account-deletion', authMiddleware, authController.confirmAccountDeletion);

module.exports = router;
