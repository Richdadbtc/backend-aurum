const router = require('express').Router();
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/support.controller');

router.use(protect);

router.get('/messages', ctrl.getMyMessages);
router.post('/messages', ctrl.sendMyMessage);

module.exports = router;
