const mongoose = require('mongoose');

const collectiveSchema = new mongoose.Schema({
  title:       { type: String, required: true },
  description: { type: String, default: '' },
  location: {
    type:        { type: String, enum: ['Point'], required: true },
    coordinates: { type: [Number], required: true }, // [lng, lat]
    addressText: { type: String, default: 'Bilinmiyor' },
  },
  radius:        { type: Number, default: 150 },  // metres — geofence for checkin
  requiredCount: { type: Number, required: true },
  checkedIn:     [{ type: String }],              // userIds physically in radius
  readyUsers:    [{ type: String }],              // pressed "I'm In" simultaneously
  unlockedAt:    { type: Date, default: null },
  status: {
    type:    String,
    enum:    ['seeding', 'active', 'unlocked', 'failed'],
    default: 'seeding',
  },
  expiresAt:  { type: Date, required: true },
  createdAt:  { type: Date, default: Date.now },
});

collectiveSchema.index({ location: '2dsphere' });
collectiveSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Collective', collectiveSchema);
