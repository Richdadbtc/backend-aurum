const mongoose = require('mongoose');

const goldHoldingSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    gramsHeld: { type: Number, default: 0, min: 0 },
    averageBuyPrice: { type: Number, default: 0 },
    totalInvested: { type: Number, default: 0 },
    serialNumbers: [{ type: String }],
  },
  { timestamps: true }
);

module.exports = mongoose.model('GoldHolding', goldHoldingSchema);
