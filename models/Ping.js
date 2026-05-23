const mongoose = require('mongoose');

const pingSchema = new mongoose.Schema({
  creatorId:  { type: String, required: true },
  text:       { type: String, required: true, maxlength: 100 },
  location: {
    type:        { type: String, enum: ['Point'], required: true },
    coordinates: { type: [Number], required: true }, // [lng, lat]
  },
  interested: [{ type: String }],   // userIds who tapped interest
  lockedPair: [{ type: String }],   // [creatorId, partnerId] on match
  chatId:     { type: String, default: null },
  status:     { type: String, enum: ['active', 'matched', 'cancelled'], default: 'active' },
  expiresAt:  { type: Date, required: true },
  createdAt:  { type: Date, default: Date.now },
});

pingSchema.index({ location: '2dsphere' });
pingSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // auto-delete at expiry

module.exports = mongoose.model('Ping', pingSchema);
