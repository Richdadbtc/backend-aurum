const router = require('express').Router();
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/gold.controller');

router.get('/price', protect, ctrl.getPrice);
router.post('/buy', protect, ctrl.buy);
router.post('/sell', protect, ctrl.sell);

module.exports = router;
