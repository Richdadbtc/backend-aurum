const router = require('express').Router();
const { body } = require('express-validator');
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/kyc.controller');

router.use(protect);

router.post('/submit', [
  body('idType').notEmpty().withMessage('ID type required'),
], ctrl.submitKYC);

router.get('/status', ctrl.getKYCStatus);

module.exports = router;
