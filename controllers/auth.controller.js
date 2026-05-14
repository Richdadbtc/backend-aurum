const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const User = require('../models/User');
const EmailOtp = require('../models/EmailOtp');
const GoldHolding = require('../models/GoldHolding');
const emailService = require('../services/email.service');

function generateTokens(userId) {
  const accessToken = jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign({ sub: userId }, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });
  return { accessToken, refreshToken };
}

function generateOtp() {
  const n = crypto.randomInt(0, 1000000);
  return String(n).padStart(6, '0');
}

exports.requestEmailOtp = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const email = String(req.body.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

    const otp = generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await EmailOtp.findOneAndUpdate(
      { email },
      { email, otpHash, expiresAt, attempts: 0 },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await emailService.sendEmailOtp(email, otp);

    res.json({ success: true, message: 'OTP sent' });
  } catch (err) {
    next(err);
  }
};

exports.verifyEmailOtp = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const email = String(req.body.email || '').toLowerCase().trim();
    const otp = String(req.body.otp || '').trim();

    if (!email || !otp) return res.status(400).json({ success: false, message: 'Email and OTP are required' });

    const record = await EmailOtp.findOne({ email }).select('+otpHash');
    if (!record) return res.status(400).json({ success: false, message: 'Invalid or expired code' });
    if (record.expiresAt.getTime() < Date.now()) {
      await EmailOtp.deleteOne({ _id: record._id });
      return res.status(400).json({ success: false, message: 'Invalid or expired code' });
    }

    if (record.attempts >= 5) {
      return res.status(429).json({ success: false, message: 'Too many attempts. Request a new code.' });
    }

    const ok = await bcrypt.compare(otp, record.otpHash);
    if (!ok) {
      await EmailOtp.updateOne({ _id: record._id }, { $inc: { attempts: 1 } });
      return res.status(400).json({ success: false, message: 'Invalid code' });
    }

    await EmailOtp.deleteOne({ _id: record._id });

    await User.updateOne({ email }, { $set: { emailVerified: true }, $unset: { emailVerifyToken: 1, emailVerifyExpires: 1 } });

    res.json({ success: true, message: 'Email verified' });
  } catch (err) {
    next(err);
  }
};

exports.register = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const { email, phone, password, firstName, lastName, dateOfBirth, gender, state } = req.body;

    const exists = await User.findOne({ $or: [{ email }, { phone }] });
    if (exists) {
      const field = exists.email === email ? 'Email' : 'Phone number';
      return res.status(409).json({ success: false, message: `${field} already registered` });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const user = await User.create({
      email, phone, passwordHash, firstName, lastName,
      dateOfBirth, gender, state,
      emailVerifyToken: verifyToken,
      emailVerifyExpires: verifyExpires,
    });

    await GoldHolding.create({ userId: user._id });

    const { accessToken, refreshToken } = generateTokens(user._id);
    await User.findByIdAndUpdate(user._id, { $push: { refreshTokens: refreshToken } });

    emailService.sendVerifyEmail(user, verifyToken).catch(() => {});
    emailService.sendWelcomeEmail(user).catch(() => {});

    res.status(201).json({
      success: true,
      message: 'Account created. Please verify your email.',
      accessToken,
      refreshToken,
      user: {
        _id: user._id, email: user.email, firstName: user.firstName,
        lastName: user.lastName, role: user.role, kycStatus: user.kycStatus,
        kycTier: user.kycTier, emailVerified: user.emailVerified,
      },
    });
  } catch (err) { next(err); }
};

exports.verifyEmail = async (req, res, next) => {
  try {
    const user = await User.findOne({
      emailVerifyToken: req.params.token,
      emailVerifyExpires: { $gt: Date.now() },
    }).select('+emailVerifyToken +emailVerifyExpires');

    if (!user) return res.status(400).json({ success: false, message: 'Invalid or expired verification link' });

    user.emailVerified = true;
    user.emailVerifyToken = undefined;
    user.emailVerifyExpires = undefined;
    await user.save();

    res.redirect(`${process.env.CLIENT_URL}/dashboard?verified=1`);
  } catch (err) { next(err); }
};

exports.login = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+passwordHash +refreshTokens');
    if (!user) return res.status(401).json({ success: false, message: 'Invalid email or password' });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ success: false, message: 'Invalid email or password' });

    if (!user.isActive) return res.status(403).json({ success: false, message: 'Account deactivated' });
    if (user.isSuspended) return res.status(403).json({ success: false, message: 'Account suspended. Contact support.' });

    const { accessToken, refreshToken } = generateTokens(user._id);

    // Keep max 5 refresh tokens per user
    const tokens = [...(user.refreshTokens || []).slice(-4), refreshToken];
    user.refreshTokens = tokens;
    user.lastLogin = new Date();
    await user.save();

    res.json({
      success: true,
      accessToken, refreshToken,
      user: {
        _id: user._id, email: user.email, firstName: user.firstName,
        lastName: user.lastName, role: user.role, kycStatus: user.kycStatus,
        kycTier: user.kycTier, walletBalance: user.walletBalance,
        emailVerified: user.emailVerified,
      },
    });
  } catch (err) { next(err); }
};

exports.refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ success: false, message: 'Refresh token required' });

    let payload;
    try {
      payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch {
      return res.status(401).json({ success: false, message: 'Invalid refresh token' });
    }

    const user = await User.findById(payload.sub).select('+refreshTokens');
    if (!user || !user.refreshTokens.includes(refreshToken)) {
      return res.status(401).json({ success: false, message: 'Refresh token revoked' });
    }

    const tokens = generateTokens(user._id);
    // Rotate refresh token
    user.refreshTokens = user.refreshTokens.filter((t) => t !== refreshToken);
    user.refreshTokens.push(tokens.refreshToken);
    await user.save();

    res.json({ success: true, ...tokens });
  } catch (err) { next(err); }
};

exports.logout = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken && req.user) {
      await User.findByIdAndUpdate(req.user._id, { $pull: { refreshTokens: refreshToken } });
    }
    res.json({ success: true, message: 'Logged out' });
  } catch (err) { next(err); }
};

exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    // Always return 200 to avoid user enumeration
    if (!user) return res.json({ success: true, message: 'If that email exists, a reset link has been sent' });

    const token = crypto.randomBytes(32).toString('hex');
    user.passwordResetToken = token;
    user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    emailService.sendPasswordResetEmail(user, token).catch(() => {});
    res.json({ success: true, message: 'If that email exists, a reset link has been sent' });
  } catch (err) { next(err); }
};

exports.resetPassword = async (req, res, next) => {
  try {
    const user = await User.findOne({
      passwordResetToken: req.params.token,
      passwordResetExpires: { $gt: Date.now() },
    }).select('+passwordResetToken +passwordResetExpires +refreshTokens');

    if (!user) return res.status(400).json({ success: false, message: 'Invalid or expired reset link' });

    user.passwordHash = await bcrypt.hash(req.body.password, 12);
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.refreshTokens = []; // Invalidate all sessions
    await user.save();

    res.json({ success: true, message: 'Password reset successfully. Please log in.' });
  } catch (err) { next(err); }
};
