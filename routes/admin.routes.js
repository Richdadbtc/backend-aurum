const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const ctrl = require('../controllers/admin.controller');

router.use(protect, requireAdmin);

router.get('/stats', ctrl.getStats);
router.get('/stats/volume', ctrl.getDailyVolume);
router.get('/users', ctrl.getUsers);
router.get('/users/:id', ctrl.getUserDetail);
router.put('/users/:id/suspend', ctrl.suspendUser);
router.put('/users/:id/kyc', ctrl.reviewKYC);
router.get('/transactions', ctrl.getAllTransactions);
router.get('/kyc-queue', ctrl.getKYCQueue);
router.get('/logs', ctrl.getLogs);

router.get('/support/threads', ctrl.getSupportThreads);
router.get('/support/messages', ctrl.getSupportMessages);
router.post('/support/messages', ctrl.sendSupportReply);

module.exports = router;
