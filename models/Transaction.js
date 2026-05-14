const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: ['buy', 'sell', 'deposit', 'withdrawal', 'fee'],
      required: true,
    },
    amount: { type: Number, required: true },
    gramsGold: { type: Number, default: 0 },
    pricePerGram: { type: Number, default: 0 },
    fee: { type: Number, default: 0 },
    netAmount: { type: Number, required: true },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'reversed'],
      default: 'pending',
    },
    paystackRef: { type: String, index: true, sparse: true },
    paystackStatus: { type: String },
    description: { type: String },
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ status: 1, type: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
