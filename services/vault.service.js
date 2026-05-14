const crypto = require('crypto');
const mongoose = require('mongoose');
const GoldHolding = require('../models/GoldHolding');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { getGoldPrice } = require('./goldPrice.service');
const { sendBuyReceipt } = require('./email.service');
const logger = require('../config/logger');

const FEE_RATE = 0.015;

function generateSerial() {
  return `AV-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

async function buyGold(userId, amountUSD, lockedPrice) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const user = await User.findById(userId).session(session);
    if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });
    if (user.kycTier < 1) throw Object.assign(new Error('KYC verification required to buy gold'), { statusCode: 403 });
    if (amountUSD < 10) throw Object.assign(new Error('Minimum purchase is $10'), { statusCode: 400 });

    const fee = +(amountUSD * FEE_RATE).toFixed(2);
    const total = +(amountUSD + fee).toFixed(2);

    if (user.walletBalance < total) {
      throw Object.assign(new Error('Insufficient wallet balance'), { statusCode: 400 });
    }

    const pricePerGram = lockedPrice?.perGram || (await getGoldPrice()).perGram;
    const gramsToCredit = +(amountUSD / pricePerGram).toFixed(6);

    // Deduct wallet
    user.walletBalance = +(user.walletBalance - total).toFixed(2);
    await user.save({ session });

    // Update holding
    let holding = await GoldHolding.findOne({ userId }).session(session);
    if (!holding) holding = new GoldHolding({ userId });

    const prevTotal = holding.totalInvested;
    const prevGrams = holding.gramsHeld;
    holding.gramsHeld = +(prevGrams + gramsToCredit).toFixed(6);
    holding.totalInvested = +(prevTotal + amountUSD).toFixed(2);
    holding.averageBuyPrice = holding.gramsHeld > 0
      ? +(holding.totalInvested / holding.gramsHeld).toFixed(4) : 0;
    holding.serialNumbers.push(generateSerial());
    await holding.save({ session });

    // Create transaction
    const tx = await Transaction.create([{
      userId, type: 'buy',
      amount: amountUSD, gramsGold: gramsToCredit,
      pricePerGram, fee, netAmount: amountUSD,
      status: 'completed',
      description: `Bought ${gramsToCredit.toFixed(4)}g gold at $${pricePerGram.toFixed(2)}/g`,
    }], { session });

    await session.commitTransaction();
    session.endSession();

    sendBuyReceipt(user, tx[0], holding).catch(() => {});
    return { transaction: tx[0], holding };
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
}

async function sellGold(userId, gramsToSell) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const holding = await GoldHolding.findOne({ userId }).session(session);
    if (!holding || holding.gramsHeld < gramsToSell) {
      throw Object.assign(new Error('Insufficient gold holdings'), { statusCode: 400 });
    }
    if (gramsToSell <= 0) throw Object.assign(new Error('Invalid grams amount'), { statusCode: 400 });

    const { perGram } = await getGoldPrice();
    const buybackPrice = +(perGram * 0.985).toFixed(4);
    const proceeds = +(gramsToSell * buybackPrice).toFixed(2);
    const fee = +(proceeds * FEE_RATE).toFixed(2);
    const net = +(proceeds - fee).toFixed(2);

    holding.gramsHeld = +(holding.gramsHeld - gramsToSell).toFixed(6);
    if (holding.gramsHeld <= 0) {
      holding.gramsHeld = 0;
      holding.totalInvested = 0;
      holding.averageBuyPrice = 0;
    } else {
      holding.totalInvested = +(holding.averageBuyPrice * holding.gramsHeld).toFixed(2);
    }
    await holding.save({ session });

    const user = await User.findById(userId).session(session);
    user.walletBalance = +(user.walletBalance + net).toFixed(2);
    await user.save({ session });

    const tx = await Transaction.create([{
      userId, type: 'sell',
      amount: proceeds, gramsGold: gramsToSell,
      pricePerGram: buybackPrice, fee, netAmount: net,
      status: 'completed',
      description: `Sold ${gramsToSell.toFixed(4)}g gold at $${buybackPrice.toFixed(2)}/g`,
    }], { session });

    await session.commitTransaction();
    session.endSession();
    return { transaction: tx[0], holding, net };
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
}

// Auto-invest cron processor
async function processAutoInvests() {
  const now = new Date();
  const users = await User.find({
    'autoInvest.enabled': true,
    'autoInvest.nextRun': { $lte: now },
    kycTier: { $gte: 1 },
    isSuspended: false,
  });

  for (const user of users) {
    try {
      const { amount, frequency } = user.autoInvest;
      if (user.walletBalance >= amount * 1.015) {
        await buyGold(user._id, amount, null);
        logger.info(`Auto-invest executed for user ${user._id}: $${amount}`);
      }
      // Schedule next run
      const next = new Date();
      if (frequency === 'daily') next.setDate(next.getDate() + 1);
      else if (frequency === 'weekly') next.setDate(next.getDate() + 7);
      else next.setMonth(next.getMonth() + 1);
      user.autoInvest.nextRun = next;
      await user.save();
    } catch (err) {
      logger.error(`Auto-invest failed for ${user._id}: ${err.message}`);
    }
  }
}

module.exports = { buyGold, sellGold, processAutoInvests };
