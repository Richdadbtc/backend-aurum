const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/auth.controller');
const { authLimiter } = require('../middleware/rateLimiter');
const { protect } = require('../middleware/auth');

const pwRules = [
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
];

router.post('/register', authLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('phone').matches(/^\+?[1-9]\d{6,14}$/).withMessage('Invalid phone number'),
  ...pwRules,
  body('firstName').trim().isLength({ min: 2 }),
  body('lastName').trim().isLength({ min: 2 }),
], ctrl.register);

router.post('/email-otp/request', authLimiter, [
  body('email').isEmail().normalizeEmail(),
], ctrl.requestEmailOtp);

router.post('/email-otp/verify', authLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('otp').isLength({ min: 4, max: 10 }).trim(),
], ctrl.verifyEmailOtp);

router.get('/verify-email/:token', ctrl.verifyEmail);

router.post('/login', authLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], ctrl.login);

router.post('/refresh', ctrl.refresh);
router.post('/logout', protect, ctrl.logout);

router.post('/forgot-password', [body('email').isEmail().normalizeEmail()], ctrl.forgotPassword);
router.post('/reset-password/:token', pwRules, ctrl.resetPassword);

module.exports = router;
