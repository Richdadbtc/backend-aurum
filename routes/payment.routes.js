const router = require('express').Router();
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/payment.controller');

// Webhook must come BEFORE protect middleware (no JWT needed)
router.post('/webhook', ctrl.webhook);

router.use(protect);
router.post('/initiate', ctrl.initiateDeposit);
router.get('/verify/:reference', ctrl.verifyPayment);
router.post('/withdraw', ctrl.withdraw);
router.get('/banks', ctrl.getBanks);

module.exports = router;
