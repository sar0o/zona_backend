const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
  // ─── Core ────────────────────────────────────────────────────────────────────
  author:        { type: String, required: true },
  userId:        { type: String, required: true },
  title:         { type: String, required: true },
  content:       { type: String, required: true },
  category:      { type: String, required: true },

  // ─── GeoJSON Location ────────────────────────────────────────────────────────
  location: {
    type:        { type: String, enum: ['Point'], required: true },
    coordinates: { type: [Number], required: true }, // [longitude, latitude]
    addressText: { type: String, default: "Bilinmiyor" }
  },

  // ─── Lifecycle ────────────────────────────────────────────────────────────────
  status: {
    type: String,
    enum: ['upcoming', 'confirming', 'live', 'ended'],
    default: 'upcoming'
  },

  // ─── Participants ─────────────────────────────────────────────────────────────
  participants:          [{ type: String }],
  pendingParticipants:   [{ type: String }],
  confirmedParticipants: [{ type: String }],
  maxParticipants:       { type: Number, default: 10 },

  // ─── Timing ───────────────────────────────────────────────────────────────────
  startTime: { type: Date, default: Date.now },
  endTime:   { type: Date, default: null },
  duration:  { type: String, default: null },       // e.g. "2 Saat"

  // ─── Privacy & Access ─────────────────────────────────────────────────────────
  isPrivate:        { type: Boolean, default: false },
  password:         { type: String,  default: null },
  requiresApproval: { type: Boolean, default: false },
  friendsOnly:      { type: Boolean, default: false },
  minAgeRequired:   { type: Number,  default: 0 },   // 0 = no restriction

  // ─── Vibe / Tags / Emoji (new Gen-Z fields) ───────────────────────────────────
  vibe:  { type: String, default: null },            // e.g. "Hype", "Chill"
  tags:  [{ type: String }],                         // e.g. ["🌙 Gece", "🍕 Yemek var"]
  emoji: { type: String, default: null },            // quick energy emoji e.g. "🔥"

  // ─── Moments (live-only photo stream) ────────────────────────────────────────
  moments: [{
    userId:    { type: String, required: true },
    username:  { type: String, required: true },
    imageUrl:  { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
  }],

  // ─── Tethered Blackout / Dark Room ───────────────────────────────────────────
  blackoutMode: { type: Boolean, default: false },
  darkroomPhotos: [{
    userId:    { type: String, required: true },
    username:  { type: String, required: true },
    imageUrl:  { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
  }],

  // ─── Archiving & Memory Corner ────────────────────────────────────────────────
  isArchived: { type: Boolean, default: false },   // kept for Memory Corner after completion

  // ─── Ratings ──────────────────────────────────────────────────────────────────
  // Activity-level rating (1-5) submitted by participants after it ends
  activityRatingSum:   { type: Number, default: 0 },
  activityRatingCount: { type: Number, default: 0 },

  // ─── Misc ─────────────────────────────────────────────────────────────────────
  isSponsored: { type: Boolean, default: false },
  createdAt:   { type: Date, default: Date.now }
});

// Critical: enables geospatial queries ($geoNear, $nearSphere etc.)
activitySchema.index({ location: '2dsphere' });

// Useful secondary indexes
activitySchema.index({ userId: 1 });
activitySchema.index({ endTime: 1 });       // makes the cron cleanup query fast
activitySchema.index({ createdAt: -1 });

module.exports = mongoose.model('Activity', activitySchema);