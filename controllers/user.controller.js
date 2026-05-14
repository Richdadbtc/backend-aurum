const User = require('../models/User');
const GoldHolding = require('../models/GoldHolding');
const Transaction = require('../models/Transaction');
const { getGoldPrice } = require('../services/goldPrice.service');

exports.getMe = async (req, res, next) => {
  try {
    res.json({ success: true, user: req.user });
  } catch (err) { next(err); }
};

exports.updateMe = async (req, res, next) => {
  try {
    const allowed = ['firstName', 'lastName', 'state', 'gender'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true, runValidators: true });
    res.json({ success: true, user });
  } catch (err) { next(err); }
};

exports.getHoldings = async (req, res, next) => {
  try {
    const [holding, price] = await Promise.all([
      GoldHolding.findOne({ userId: req.user._id }),
      getGoldPrice(),
    ]);

    const currentValue = holding ? +(holding.gramsHeld * price.perGram).toFixed(2) : 0;
    const pnl = holding ? +(currentValue - holding.totalInvested).toFixed(2) : 0;
    const pnlPct = holding?.totalInvested > 0 ? +((pnl / holding.totalInvested) * 100).toFixed(2) : 0;

    res.json({
      success: true,
      holding: holding || { gramsHeld: 0, averageBuyPrice: 0, totalInvested: 0 },
      currentValue,
      pnl,
      pnlPct,
      price,
    });
  } catch (err) { next(err); }
};

exports.getTransactions = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const filter = { userId: req.user._id };
    if (req.query.type) filter.type = req.query.type;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.from || req.query.to) {
      filter.createdAt = {};
      if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
      if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
    }

    const [transactions, total] = await Promise.all([
      Transaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Transaction.countDocuments(filter),
    ]);

    res.json({
      success: true,
      transactions,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
};

exports.getDashboard = async (req, res, next) => {
  try {
    const [holding, price, recentTxs] = await Promise.all([
      GoldHolding.findOne({ userId: req.user._id }),
      getGoldPrice(),
      Transaction.find({ userId: req.user._id, status: 'completed' })
        .sort({ createdAt: -1 }).limit(5),
    ]);

    const gramsHeld = holding?.gramsHeld || 0;
    const totalInvested = holding?.totalInvested || 0;
    const currentValue = +(gramsHeld * price.perGram).toFixed(2);
    const pnl = +(currentValue - totalInvested).toFixed(2);
    const pnlPct = totalInvested > 0 ? +((pnl / totalInvested) * 100).toFixed(2) : 0;

    res.json({
      success: true,
      portfolio: {
        gramsHeld, totalInvested, currentValue, pnl, pnlPct,
        averageBuyPrice: holding?.averageBuyPrice || 0,
        walletBalance: req.user.walletBalance,
      },
      price,
      recentTransactions: recentTxs,
    });
  } catch (err) { next(err); }
};

exports.getAutoInvest = async (req, res, next) => {
  try {
    res.json({ success: true, autoInvest: req.user.autoInvest });
  } catch (err) { next(err); }
};

exports.setAutoInvest = async (req, res, next) => {
  try {
    const { enabled, amount, frequency } = req.body;
    const update = { 'autoInvest.enabled': enabled };
    if (amount !== undefined) update['autoInvest.amount'] = amount;
    if (frequency) update['autoInvest.frequency'] = frequency;
    if (enabled) {
      const next = new Date();
      if (frequency === 'daily') next.setDate(next.getDate() + 1);
      else if (frequency === 'weekly') next.setDate(next.getDate() + 7);
      else next.setMonth(next.getMonth() + 1);
      update['autoInvest.nextRun'] = next;
    }
    const user = await User.findByIdAndUpdate(req.user._id, update, { new: true });
    res.json({ success: true, autoInvest: user.autoInvest });
  } catch (err) { next(err); }
};
