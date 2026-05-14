const User = require('../models/User');
const KYCRequest = require('../models/KYCRequest');
const kycService = require('../services/kyc.service');
const logger = require('../config/logger');

exports.submitKYC = async (req, res, next) => {
  try {
    const { bvn, nin, idType } = req.body;
    const user = req.user;

    if (user.kycStatus === 'verified') {
      return res.status(400).json({ success: false, message: 'KYC already verified' });
    }

    const existing = await KYCRequest.findOne({ userId: user._id, status: { $in: ['pending', 'processing'] } });
    if (existing) {
      return res.status(400).json({ success: false, message: 'KYC submission already under review' });
    }

    const kycReq = await KYCRequest.create({
      userId: user._id, bvn, nin, idType,
      status: 'processing',
    });

    // Update user KYC status
    await User.findByIdAndUpdate(user._id, { kycStatus: 'submitted', bvn, nin, idType });

    // Call Smile Identity asynchronously
    const fullUser = await User.findById(user._id);
    kycService.verifyIdentity({
      bvn, nin, idType,
      firstName: fullUser.firstName,
      lastName: fullUser.lastName,
      dob: fullUser.dateOfBirth?.toISOString()?.split('T')[0],
    }).then(async (result) => {
      kycReq.smileJobId = result.jobId;
      kycReq.smileResult = result;

      if (result.approved) {
        kycReq.status = 'approved';
        await User.findByIdAndUpdate(user._id, { kycStatus: 'verified', kycTier: 1 });
      } else if (result.manualReview) {
        kycReq.status = 'pending'; // Queue for manual admin review
      } else {
        kycReq.status = 'rejected';
        kycReq.rejectionReason = result.resultText;
        await User.findByIdAndUpdate(user._id, { kycStatus: 'rejected' });
      }
      await kycReq.save();
    }).catch((err) => {
      logger.error(`KYC async error for ${user._id}: ${err.message}`);
    });

    res.status(202).json({
      success: true,
      message: 'KYC submitted and under review. This typically takes under 60 seconds.',
      kycRequestId: kycReq._id,
    });
  } catch (err) { next(err); }
};

exports.getKYCStatus = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    const latest = await KYCRequest.findOne({ userId: user._id }).sort({ createdAt: -1 });

    res.json({
      success: true,
      kycStatus: user.kycStatus,
      kycTier: user.kycTier,
      latestRequest: latest ? { status: latest.status, rejectionReason: latest.rejectionReason, createdAt: latest.createdAt } : null,
    });
  } catch (err) { next(err); }
};
