const mongoose = require('mongoose');

const supportMessageSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    senderRole: { type: String, enum: ['user', 'admin', 'bot'], required: true, index: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
    message: { type: String, required: true, trim: true },
    isReadByUser: { type: Boolean, default: false },
    isReadByAdmin: { type: Boolean, default: false },
  },
  { timestamps: true }
);

supportMessageSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('SupportMessage', supportMessageSchema);
