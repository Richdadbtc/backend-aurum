const crypto = require('crypto');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const paymentService = require('../services/payment.service');
const logger = require('../config/logger');

exports.initiateDeposit = async (req, res, next) => {
  try {
    const { amount } = req.body;
    if (!amount || amount < 1) {
      return res.status(400).json({ success: false, message: 'Minimum deposit is $1' });
    }

    const reference = `AV-DEP-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    const tx = await Transaction.create({
      userId: req.user._id, type: 'deposit',
      amount, netAmount: amount, fee: 0,
      status: 'pending', paystackRef: reference,
      description: `Wallet deposit of $${amount}`,
    });

    const payData = await paymentService.initializePayment({
      email: req.user.email,
      amount,
      reference,
      metadata: { userId: req.user._id.toString(), transactionId: tx._id.toString() },
    });

    res.json({ success: true, authorizationUrl: payData.authorization_url, reference });
  } catch (err) { next(err); }
};

exports.verifyPayment = async (req, res, next) => {
  try {
    const { reference } = req.params;
    const tx = await Transaction.findOne({ paystackRef: reference });

    if (!tx) return res.status(404).json({ success: false, message: 'Transaction not found' });
    if (tx.status === 'completed') {
      return res.redirect(`${process.env.CLIENT_URL}/dashboard?deposit=success`);
    }

    const psData = await paymentService.verifyPayment(reference);
    if (psData.status !== 'success') {
      tx.status = 'failed';
      await tx.save();
      return res.redirect(`${process.env.CLIENT_URL}/dashboard?deposit=failed`);
    }

    const amountPaid = +(psData.amount / 100).toFixed(2);
    tx.status = 'completed';
    tx.amount = amountPaid;
    tx.netAmount = amountPaid;
    tx.paystackStatus = psData.status;
    await tx.save();

    await User.findByIdAndUpdate(tx.userId, { $inc: { walletBalance: amountPaid } });

    res.redirect(`${process.env.CLIENT_URL}/dashboard?deposit=success&amount=${amountPaid}`);
  } catch (err) { next(err); }
};

exports.webhook = async (req, res, next) => {
  try {
    const signature = req.headers['x-paystack-signature'];
    if (!paymentService.verifyWebhookSignature(req.body, signature)) {
      return res.status(400).json({ message: 'Invalid signature' });
    }

    const event = JSON.parse(req.body);
    if (event.event === 'charge.success') {
      const { reference, amount, status } = event.data;

      // Idempotency check
      const tx = await Transaction.findOne({ paystackRef: reference });
      if (!tx || tx.status === 'completed') return res.sendStatus(200);

      const amountPaid = +(amount / 100).toFixed(2);
      tx.status = 'completed';
      tx.amount = amountPaid;
      tx.netAmount = amountPaid;
      tx.paystackStatus = status;
      await tx.save();

      await User.findByIdAndUpdate(tx.userId, { $inc: { walletBalance: amountPaid } });
      logger.info(`Webhook: deposit ${reference} completed for user ${tx.userId}`);
    }

    res.sendStatus(200);
  } catch (err) {
    logger.error(`Webhook error: ${err.message}`);
    res.sendStatus(200); // Always 200 to Paystack
  }
};

exports.withdraw = async (req, res, next) => {
  try {
    const { amount, accountNumber, bankCode, accountName } = req.body;
    const user = await User.findById(req.user._id);

    if (!amount || amount < 1) return res.status(400).json({ success: false, message: 'Minimum withdrawal is $1' });
    if (user.walletBalance < amount) return res.status(400).json({ success: false, message: 'Insufficient balance' });

    const reference = `AV-WDR-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    const recipient = await paymentService.createTransferRecipient({ name: accountName, accountNumber, bankCode });
    await paymentService.initiateTransfer({ amount, recipientCode: recipient.recipient_code, reference, reason: 'Aurum Vault withdrawal' });

    const tx = await Transaction.create({
      userId: user._id, type: 'withdrawal',
      amount, fee: 0, netAmount: amount,
      status: 'processing', paystackRef: reference,
      description: `Withdrawal to ${accountName} (${accountNumber})`,
    });

    user.walletBalance = +(user.walletBalance - amount).toFixed(2);
    await user.save();

    res.json({ success: true, transaction: tx });
  } catch (err) { next(err); }
};

exports.getBanks = async (req, res, next) => {
  try {
    const banks = await paymentService.getBankList();
    res.json({ success: true, banks });
  } catch (err) { next(err); }
};
