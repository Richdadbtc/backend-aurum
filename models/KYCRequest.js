const mongoose = require('mongoose');

const kycRequestSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    bvn: { type: String, select: false },
    nin: { type: String, select: false },
    idType: { type: String },
    idNumber: { type: String, select: false },
    smileJobId: { type: String },
    smileResult: { type: mongoose.Schema.Types.Mixed, select: false },
    status: {
      type: String,
      enum: ['pending', 'processing', 'approved', 'rejected'],
      default: 'pending',
    },
    rejectionReason: { type: String },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model('KYCRequest', kycRequestSchema);
