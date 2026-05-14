const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String, required: true, unique: true,
      lowercase: true, trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email'],
    },
    phone: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    dateOfBirth: { type: Date },
    gender: { type: String, enum: ['male', 'female', 'other'] },
    state: { type: String },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    kycStatus: {
      type: String,
      enum: ['pending', 'submitted', 'verified', 'rejected'],
      default: 'pending',
    },
    kycTier: { type: Number, enum: [0, 1, 2, 3], default: 0 },
    bvn: { type: String, select: false },
    nin: { type: String, select: false },
    idType: { type: String },
    idNumber: { type: String, select: false },
    walletBalance: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    isSuspended: { type: Boolean, default: false },
    emailVerified: { type: Boolean, default: false },
    emailVerifyToken: { type: String, select: false },
    emailVerifyExpires: { type: Date, select: false },
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    refreshTokens: { type: [String], select: false },
    autoInvest: {
      enabled: { type: Boolean, default: false },
      amount: { type: Number, default: 0 },
      frequency: { type: String, enum: ['daily', 'weekly', 'monthly'] },
      nextRun: { type: Date },
    },
    lastLogin: { type: Date },
  },
  { timestamps: true }
);

userSchema.methods.comparePassword = async function (plain) {
  const hash = await mongoose.model('User').findById(this._id).select('+passwordHash');
  return bcrypt.compare(plain, hash.passwordHash);
};

userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.passwordHash;
  delete obj.refreshTokens;
  delete obj.bvn;
  delete obj.nin;
  delete obj.idNumber;
  delete obj.emailVerifyToken;
  delete obj.emailVerifyExpires;
  delete obj.passwordResetToken;
  delete obj.passwordResetExpires;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
