const { getGoldPrice, lockPriceForUser, getLockedPrice, clearLockedPrice } = require('../services/goldPrice.service');
const { buyGold, sellGold } = require('../services/vault.service');
const { sendSellReceipt } = require('../services/email.service');

exports.getPrice = async (req, res, next) => {
  try {
    const price = await getGoldPrice();
    // Lock this price for the requesting user (30s window)
    lockPriceForUser(req.user?._id, price);
    res.json({ success: true, price });
  } catch (err) { next(err); }
};

exports.buy = async (req, res, next) => {
  try {
    const amountUSD = parseFloat(req.body.amount);
    if (isNaN(amountUSD) || amountUSD <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid amount' });
    }

    const lockedPrice = getLockedPrice(req.user._id);
    const { transaction, holding } = await buyGold(req.user._id, amountUSD, lockedPrice);
    clearLockedPrice(req.user._id);

    res.status(201).json({ success: true, transaction, holding });
  } catch (err) { next(err); }
};

exports.sell = async (req, res, next) => {
  try {
    const gramsToSell = parseFloat(req.body.grams);
    if (isNaN(gramsToSell) || gramsToSell <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid grams amount' });
    }

    const { transaction, holding, net } = await sellGold(req.user._id, gramsToSell);
    sendSellReceipt(req.user, transaction).catch(() => {});

    res.json({ success: true, transaction, holding, netProceeds: net });
  } catch (err) { next(err); }
};
