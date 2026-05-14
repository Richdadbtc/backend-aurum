const router = require('express').Router();
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/user.controller');

router.use(protect);

router.get('/me', ctrl.getMe);
router.put('/me', ctrl.updateMe);
router.get('/holdings', ctrl.getHoldings);
router.get('/transactions', ctrl.getTransactions);
router.get('/dashboard', ctrl.getDashboard);
router.get('/auto-invest', ctrl.getAutoInvest);
router.put('/auto-invest', ctrl.setAutoInvest);

module.exports = router;
