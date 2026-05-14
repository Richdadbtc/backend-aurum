const SupportMessage = require('../models/SupportMessage');

exports.getMyMessages = async (req, res, next) => {
  try {
    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const before = req.query.before ? new Date(req.query.before) : null;

    const filter = { userId: req.user._id };
    if (before) filter.createdAt = { $lt: before };

    const messages = await SupportMessage.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit);

    await SupportMessage.updateMany(
      { userId: req.user._id, senderRole: { $in: ['admin', 'bot'] }, isReadByUser: false },
      { $set: { isReadByUser: true } }
    );

    res.json({ success: true, messages: messages.reverse() });
  } catch (err) { next(err); }
};

exports.sendMyMessage = async (req, res, next) => {
  try {
    const text = String(req.body?.message || '').trim();
    if (!text) return res.status(400).json({ success: false, message: 'Message is required' });
    if (text.length > 2000) return res.status(400).json({ success: false, message: 'Message too long' });

    const msg = await SupportMessage.create({
      userId: req.user._id,
      senderRole: 'user',
      senderId: req.user._id,
      message: text,
      isReadByAdmin: false,
      isReadByUser: true,
    });

    let botReply = null;
    const lower = text.toLowerCase();
    if (/(deposit|fund|paystack|payment)/.test(lower)) {
      botReply = 'If your deposit is not reflected, please check the Transactions tab and share the reference if available.';
    } else if (/(withdraw|payout)/.test(lower)) {
      botReply = 'Withdrawals may take some time to process. If it has been over 24 hours, share the amount and date so an admin can review.';
    } else if (/(kyc|verify|verification|id)/.test(lower)) {
      botReply = 'KYC status updates after submission. If it remains pending for long, an admin can review it from the queue.';
    } else if (/(buy|sell|price)/.test(lower)) {
      botReply = 'Buying and selling requires a live price and (for buying) a verified KYC status. Please confirm your KYC badge in Profile & KYC.';
    }

    let botMsg = null;
    if (botReply) {
      botMsg = await SupportMessage.create({
        userId: req.user._id,
        senderRole: 'bot',
        message: botReply,
        isReadByAdmin: false,
        isReadByUser: false,
      });
    }

    res.json({ success: true, message: msg, bot: botMsg });
  } catch (err) { next(err); }
};
