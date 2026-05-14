const User = require('../models/User');
const Transaction = require('../models/Transaction');
const GoldHolding = require('../models/GoldHolding');
const KYCRequest = require('../models/KYCRequest');
const AdminLog = require('../models/AdminLog');
const SupportMessage = require('../models/SupportMessage');
const emailService = require('../services/email.service');

async function logAction(adminId, action, targetUserId, details, req) {
  await AdminLog.create({
    adminId, action, targetUserId, details,
    ipAddress: req.ip || req.connection?.remoteAddress,
  });
}

exports.getStats = async (req, res, next) => {
  try {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [
      totalUsers, verifiedUsers, suspendedUsers, pendingKYC,
      totalHoldings, todayVolume, todayRevenue, totalRevenue,
    ] = await Promise.all([
      User.countDocuments({ role: 'user' }),
      User.countDocuments({ kycStatus: 'verified' }),
      User.countDocuments({ isSuspended: true }),
      KYCRequest.countDocuments({ status: 'pending' }),
      GoldHolding.aggregate([{ $group: { _id: null, total: { $sum: '$gramsHeld' } } }]),
      Transaction.aggregate([
        { $match: { status: 'completed', type: { $in: ['buy', 'sell'] }, createdAt: { $gte: startOfDay } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Transaction.aggregate([
        { $match: { status: 'completed', type: { $in: ['buy', 'sell'] }, createdAt: { $gte: startOfDay } } },
        { $group: { _id: null, total: { $sum: '$fee' } } },
      ]),
      Transaction.aggregate([
        { $match: { status: 'completed', type: { $in: ['buy', 'sell'] } } },
        { $group: { _id: null, total: { $sum: '$fee' } } },
      ]),
    ]);

    res.json({
      success: true,
      stats: {
        totalUsers,
        verifiedUsers,
        kycVerifiedPct: totalUsers > 0 ? +((verifiedUsers / totalUsers) * 100).toFixed(1) : 0,
        suspendedUsers,
        pendingKYC,
        totalAUM: totalHoldings[0]?.total || 0,
        todayVolume: todayVolume[0]?.total || 0,
        todayRevenue: todayRevenue[0]?.total || 0,
        totalRevenue: totalRevenue[0]?.total || 0,
      },
    });
  } catch (err) { next(err); }
};

exports.getDailyVolume = async (req, res, next) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const data = await Transaction.aggregate([
      { $match: { status: 'completed', type: { $in: ['buy', 'sell'] }, createdAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, volume: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

exports.getUsers = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 25);
    const skip = (page - 1) * limit;

    const filter = { role: 'user' };
    if (req.query.search) {
      const re = new RegExp(req.query.search, 'i');
      filter.$or = [{ email: re }, { firstName: re }, { lastName: re }];
    }
    if (req.query.kycStatus) filter.kycStatus = req.query.kycStatus;
    if (req.query.suspended === 'true') filter.isSuspended = true;

    const [users, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);

    res.json({ success: true, users, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
};

exports.getUserDetail = async (req, res, next) => {
  try {
    const [user, holding, transactions, kycReq] = await Promise.all([
      User.findById(req.params.id),
      GoldHolding.findOne({ userId: req.params.id }),
      Transaction.find({ userId: req.params.id }).sort({ createdAt: -1 }).limit(10),
      KYCRequest.findOne({ userId: req.params.id }).sort({ createdAt: -1 }),
    ]);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    res.json({ success: true, user, holding, transactions, kycRequest: kycReq });
  } catch (err) { next(err); }
};

exports.suspendUser = async (req, res, next) => {
  try {
    const { suspend, reason } = req.body;
    const user = await User.findByIdAndUpdate(req.params.id, { isSuspended: !!suspend }, { new: true });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    await logAction(req.user._id, suspend ? 'SUSPEND_USER' : 'REINSTATE_USER', user._id, { reason }, req);
    res.json({ success: true, user });
  } catch (err) { next(err); }
};

exports.reviewKYC = async (req, res, next) => {
  try {
    const { action, reason } = req.body; // action: 'approve' | 'reject'
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const kycReq = await KYCRequest.findOne({ userId: user._id }).sort({ createdAt: -1 });

    if (action === 'approve') {
      user.kycStatus = 'verified';
      user.kycTier = 2;
      if (kycReq) { kycReq.status = 'approved'; kycReq.reviewedBy = req.user._id; kycReq.reviewedAt = new Date(); await kycReq.save(); }
      emailService.sendKycApprovedEmail(user).catch(() => {});
    } else if (action === 'reject') {
      if (!reason) return res.status(400).json({ success: false, message: 'Rejection reason required' });
      user.kycStatus = 'rejected';
      user.kycTier = 0;
      if (kycReq) { kycReq.status = 'rejected'; kycReq.rejectionReason = reason; kycReq.reviewedBy = req.user._id; kycReq.reviewedAt = new Date(); await kycReq.save(); }
      emailService.sendKycRejectedEmail(user, reason).catch(() => {});
    } else {
      return res.status(400).json({ success: false, message: 'Invalid action' });
    }

    await user.save();
    await logAction(req.user._id, `KYC_${action.toUpperCase()}`, user._id, { reason }, req);
    res.json({ success: true, user });
  } catch (err) { next(err); }
};

exports.getAllTransactions = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 25);
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.type) filter.type = req.query.type;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.userId) filter.userId = req.query.userId;
    if (req.query.from || req.query.to) {
      filter.createdAt = {};
      if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
      if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
    }

    const [transactions, total] = await Promise.all([
      Transaction.find(filter).populate('userId', 'email firstName lastName').sort({ createdAt: -1 }).skip(skip).limit(limit),
      Transaction.countDocuments(filter),
    ]);

    res.json({ success: true, transactions, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
};

exports.getKYCQueue = async (req, res, next) => {
  try {
    const requests = await KYCRequest.find({ status: 'pending' })
      .populate('userId', 'email firstName lastName dateOfBirth')
      .sort({ createdAt: 1 });
    res.json({ success: true, requests });
  } catch (err) { next(err); }
};

exports.getLogs = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 25);
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      AdminLog.find().populate('adminId', 'email firstName lastName').populate('targetUserId', 'email').sort({ createdAt: -1 }).skip(skip).limit(limit),
      AdminLog.countDocuments(),
    ]);

    res.json({ success: true, logs, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
};

exports.getSupportThreads = async (req, res, next) => {
  try {
    const limit = Math.min(100, parseInt(req.query.limit) || 50);

    const threads = await SupportMessage.aggregate([
      { $sort: { createdAt: -1 } },
      { $group: {
        _id: '$userId',
        lastMessageAt: { $first: '$createdAt' },
        lastMessage: { $first: '$message' },
        lastSenderRole: { $first: '$senderRole' },
        unreadCount: { $sum: { $cond: [{ $and: [{ $eq: ['$senderRole', 'user'] }, { $eq: ['$isReadByAdmin', false] }] }, 1, 0] } },
      } },
      { $sort: { lastMessageAt: -1 } },
      { $limit: limit },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      { $project: {
        userId: '$_id',
        lastMessageAt: 1,
        lastMessage: 1,
        lastSenderRole: 1,
        unreadCount: 1,
        user: { email: '$user.email', firstName: '$user.firstName', lastName: '$user.lastName' },
      } },
    ]);

    res.json({ success: true, threads });
  } catch (err) { next(err); }
};

exports.getSupportMessages = async (req, res, next) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ success: false, message: 'userId is required' });

    const limit = Math.min(500, parseInt(req.query.limit) || 100);
    const messages = await SupportMessage.find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit);

    await SupportMessage.updateMany(
      { userId, senderRole: { $in: ['user', 'bot'] }, isReadByAdmin: false },
      { $set: { isReadByAdmin: true } }
    );

    res.json({ success: true, messages: messages.reverse() });
  } catch (err) { next(err); }
};

exports.sendSupportReply = async (req, res, next) => {
  try {
    const userId = req.body?.userId;
    const text = String(req.body?.message || '').trim();
    if (!userId) return res.status(400).json({ success: false, message: 'userId is required' });
    if (!text) return res.status(400).json({ success: false, message: 'Message is required' });
    if (text.length > 2000) return res.status(400).json({ success: false, message: 'Message too long' });

    const msg = await SupportMessage.create({
      userId,
      senderRole: 'admin',
      senderId: req.user._id,
      message: text,
      isReadByAdmin: true,
      isReadByUser: false,
    });

    await logAction(req.user._id, 'SUPPORT_REPLY', userId, { messageId: msg._id }, req);

    res.json({ success: true, message: msg });
  } catch (err) { next(err); }
};
