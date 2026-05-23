const express    = require('express');
const cors       = require('cors');
const fs         = require('fs');
const nodemailer = require('nodemailer');
const multer     = require('multer');
const path       = require('path');
const _storage   = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});
const upload     = multer({ storage: _storage });
const mongoose   = require('mongoose');
const http       = require('http');
const { Server } = require('socket.io');

let ActivityModel;
try {
  ActivityModel = require('./models/Activity');
} catch (err) {
  console.log("⚠️ Activity.js dosyası bulunamadı.");
}

let PingModel;
try {
  PingModel = require('./models/Ping');
} catch (err) {
  console.log("⚠️ Ping.js bulunamadı.");
}

let CollectiveModel;
try {
  CollectiveModel = require('./models/Collective');
} catch (err) {
  console.log("⚠️ Collective.js bulunamadı.");
}

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: "*" } });

const PORT           = process.env.PORT || 3000;
const BASE_URL       = process.env.BASE_URL || `http://localhost:${PORT}`;
const USERS_FILE     = './users.json';
const ACTIVITIES_FILE = './activities.json';

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// ─── MongoDB ──────────────────────────────────────────────────────────────────
mongoose.connect('mongodb+srv://BadyySarp:roqso7-kedpof-vyQxuf@badyy.dropkeo.mongodb.net/?appName=Badyy')
  .then(() => console.log("✅ MongoDB Bağlantısı Başarılı!"))
  .catch(err => console.log("⚠️ MongoDB Hatası:", err.message));

// ─── JSON Fallback Store ──────────────────────────────────────────────────────
let users = [];
if (fs.existsSync(USERS_FILE)) {
  try { users = JSON.parse(fs.readFileSync(USERS_FILE)); } catch { users = []; }
}
const saveUsers = () => fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

let activities = [];
if (fs.existsSync(ACTIVITIES_FILE)) {
  try { activities = JSON.parse(fs.readFileSync(ACTIVITIES_FILE)); } catch { activities = []; }
}
const saveActivities = () => fs.writeFileSync(ACTIVITIES_FILE, JSON.stringify(activities, null, 2));

const pendingUsers = {};

// ─── Mailer ───────────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: 'zonaauth@gmail.com', pass: 'jhbf ekeo dggr jgnq' }
});

// ─── Badge Definitions ────────────────────────────────────────────────────────
const BADGE_TIERS = [
  { id: 'starter',   emoji: '🌱', name: 'Başlangıç',       minActivities: 1,  xpBonus: 0   },
  { id: 'social',    emoji: '🦋', name: 'Sosyal Kelebek',  minActivities: 5,  xpBonus: 50  },
  { id: 'active',    emoji: '⚡', name: 'Aktif Ruh',       minActivities: 10, xpBonus: 100 },
  { id: 'master',    emoji: '🏆', name: 'Plan Ustası',     minActivities: 25, xpBonus: 250 },
  { id: 'legend',    emoji: '👑', name: 'Efsane',          minActivities: 50, xpBonus: 500 },
];

const XP_PER_ACTIVITY = 50;

const computeBadges = (completedCount) =>
  BADGE_TIERS.filter(b => completedCount >= b.minActivities).map(b => b.id);

const awardXpToParticipants = (participantIds, xpAmount) => {
  let changed = false;
  for (const uid of participantIds) {
    const u = users.find(u => u.id === uid);
    if (!u) continue;
    if (!u.xp) u.xp = 0;
    if (!u.activitiesCompleted) u.activitiesCompleted = 0;
    u.xp += xpAmount;
    u.activitiesCompleted += 1;
    u.badges = computeBadges(u.activitiesCompleted);
    changed = true;
  }
  if (changed) saveUsers();
};

const updateStreak = (user) => {
  const today = new Date().toISOString().split('T')[0];
  const last = user.lastActivityDate;
  if (!last) {
    user.streakDays = 1;
  } else {
    const lastDay = new Date(last).toISOString().split('T')[0];
    if (lastDay !== today) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      user.streakDays = lastDay === yesterday ? (user.streakDays || 0) + 1 : 1;
    }
  }
  user.lastActivityDate = today;
  user.longestStreak = Math.max(user.longestStreak || 0, user.streakDays || 0);
};

const updateStreakForUser = (userId) => {
  const u = users.find(u => u.id === userId);
  if (!u) return;
  updateStreak(u);
  saveUsers();
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const generateUniqueID = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  while (true) {
    result = 'user_';
    for (let i = 0; i < 10; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    if (!users.some(u => u.id === result)) break;
  }
  return result;
};

// ─── Format a Mongo activity doc into the shape Flutter expects ───────────────
const formatActivity = (act, distanceInMeters = 0) => ({
  id:                    act._id || act.id,
  author:                act.author,
  userId:                act.userId,
  title:                 act.title,
  content:               act.content,
  category:              act.category,
  latitude:              act.location?.coordinates ? act.location.coordinates[1] : (act.location?.latitude || 0),
  longitude:             act.location?.coordinates ? act.location.coordinates[0] : (act.location?.longitude || 0),
  addressText:           act.location?.addressText || act.addressText || "Bilinmiyor",
  distanceInKm:          (distanceInMeters / 1000).toFixed(2),
  participants:          act.participants || [],
  pendingParticipants:   act.pendingParticipants || [],
  confirmedParticipants: act.confirmedParticipants || [],
  maxParticipants:       act.maxParticipants,
  startTime:             act.startTime,
  endTime:               act.endTime,
  duration:              act.duration,
  status:                act.status || computeStatus(act),
  isPrivate:             act.isPrivate,
  requiresApproval:      act.requiresApproval,
  friendsOnly:           act.friendsOnly,
  minAgeRequired:        act.minAgeRequired,
  vibe:                  act.vibe,
  tags:                  act.tags || [],
  emoji:                 act.emoji,
  isSponsored:           act.isSponsored,
  createdAt:             act.createdAt,
  moments:               act.moments || [],
  blackoutMode:          act.blackoutMode || false,
  darkroomPhotos:        act.darkroomPhotos || [],
  isArchived:            act.isArchived || false,
  activityRatingSum:     act.activityRatingSum || 0,
  activityRatingCount:   act.activityRatingCount || 0,
  avgActivityRating:     act.activityRatingCount > 0
    ? (act.activityRatingSum / act.activityRatingCount).toFixed(1)
    : null,
});

// Derive status for JSON-fallback activities that pre-date the status field
const computeStatus = (act) => {
  if (!act.startTime) return 'upcoming';
  const now = new Date();
  const start = new Date(act.startTime);
  const end = act.endTime ? new Date(act.endTime) : null;
  if (end && end <= now) return 'ended';
  if (start <= now) return 'live';
  if (start - now <= 30 * 60 * 1000) return 'confirming';
  return 'upcoming';
};

// =============================================================================
// ⏱ CRON — lifecycle transitions every minute + cleanup every hour
// =============================================================================
setInterval(async () => {
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 60 * 1000);

  // ── JSON fallback lifecycle ────────────────────────────────────────────────
  let changed = false;
  for (const a of activities) {
    const start = a.startTime ? new Date(a.startTime) : null;
    const end   = a.endTime   ? new Date(a.endTime)   : null;
    const prev  = a.status || 'upcoming';

    if (end && end <= now && prev !== 'ended') {
      a.status = 'ended'; changed = true;
    } else if (start && start <= now && prev !== 'live' && prev !== 'ended') {
      a.status = 'live'; changed = true;
    } else if (start && start <= in30 && prev === 'upcoming') {
      a.status = 'confirming'; changed = true;
    }
  }
  if (changed) saveActivities();

  // ── MongoDB lifecycle ──────────────────────────────────────────────────────
  if (mongoose.connection.readyState === 1 && ActivityModel) {
    try {
      await ActivityModel.updateMany(
        { status: 'live', endTime: { $lte: now } },
        { $set: { status: 'ended' } }
      );
      await ActivityModel.updateMany(
        { status: { $in: ['upcoming', 'confirming'] }, startTime: { $lte: now } },
        { $set: { status: 'live' } }
      );
      await ActivityModel.updateMany(
        { status: 'upcoming', startTime: { $lte: in30, $gt: now } },
        { $set: { status: 'confirming' } }
      );
    } catch (err) { console.log("Lifecycle cron hatası:", err.message); }
  }
}, 1000 * 60); // every minute

// Cleanup & archiving hourly
setInterval(async () => {
  const now = new Date();
  const twelveHoursAgo = new Date(now - 12 * 60 * 60 * 1000);

  // JSON fallback: delete no-join activities older than 12h; delete non-archived ended ones
  const before = activities.length;
  activities = activities.filter(a => {
    const created = a.createdAt ? new Date(a.createdAt) : now;
    const hasJoiners = a.participants && a.participants.length > 1;
    if (a.status === 'ended' && !a.isArchived) return false; // clean up ended without archive
    if (a.status !== 'ended' && !hasJoiners && created < twelveHoursAgo) return false; // 12h no-join rule
    return true;
  });
  if (activities.length < before) {
    saveActivities();
    console.log(`🧹 JSON: ${before - activities.length} aktivite temizlendi.`);
  }

  if (mongoose.connection.readyState === 1 && ActivityModel) {
    try {
      // Archive ended activities that had real participants (more than creator)
      await ActivityModel.updateMany(
        { status: 'ended', isArchived: false, $expr: { $gt: [{ $size: '$participants' }, 1] } },
        { $set: { isArchived: true } }
      );
      // Delete ended non-archived (no real joiners)
      const r1 = await ActivityModel.deleteMany({ status: 'ended', isArchived: false });
      // Delete 12h no-join upcoming activities
      const r2 = await ActivityModel.deleteMany({
        status: { $in: ['upcoming', 'confirming'] },
        createdAt: { $lt: twelveHoursAgo },
        $expr: { $lte: [{ $size: '$participants' }, 1] },
      });
      const total = r1.deletedCount + r2.deletedCount;
      if (total > 0) console.log(`🧹 MongoDB: ${total} aktivite temizlendi.`);
    } catch (err) { console.log("Cleanup cron hatası:", err.message); }
  }
}, 1000 * 60 * 60);

// =============================================================================
// 💬 SOCKET.IO
// =============================================================================
io.on('connection', (socket) => {
  console.log(`🟢 Yeni Bağlantı: ${socket.id}`);

  socket.on('join_room', (roomId) => {
    socket.join(roomId);
    console.log(`Kullanıcı odaya katıldı: ${roomId}`);
  });

  // Personal notification room (used by Phantom Pings)
  socket.on('join_user_room', (userId) => {
    socket.join(`user_${userId}`);
  });

  socket.on('send_message', (data) => {
    io.to(data.roomId).emit('receive_message', data);
  });

  socket.on('update_location', (data) => {
    socket.broadcast.emit('friend_location_updated', data);
  });

  socket.on('disconnect', () => {
    console.log(`🔴 Bağlantı Koptu: ${socket.id}`);
  });
});

// =============================================================================
// 🗂 AKTİVİTE API
// =============================================================================

// 1. CREATE
app.post('/api/activities/create', async (req, res) => {
  const {
    author, userId, title, content, category,
    latitude, longitude, addressText,
    maxParticipants, startTime, endTime, duration,
    isPrivate, password, requiresApproval,
    friendsOnly, minAgeRequired,
    vibe, tags, emoji,
    isSponsored
  } = req.body;

  if (!author || !userId || !title || !content) {
    return res.status(400).json({ message: "Yazar, ID, Başlık ve İçerik zorunludur!" });
  }

  // ── MongoDB ────────────────────────────────────────────────────────────────
  let savedMongoId = null;
  if (mongoose.connection.readyState === 1 && ActivityModel) {
    try {
      const doc = new ActivityModel({
        author,
        userId,
        title,
        content,
        category:      category || "Genel",
        location: {
          type:        'Point',
          coordinates: [parseFloat(longitude) || 0, parseFloat(latitude) || 0],
          addressText: addressText || "Bilinmiyor"
        },
        participants:        [userId],
        pendingParticipants: [],
        maxParticipants:     maxParticipants || 10,
        startTime:           startTime   || new Date().toISOString(),
        endTime:             endTime     || null,
        duration:            duration    || null,
        isPrivate:           isPrivate   || false,
        password:            password    || null,
        requiresApproval:    requiresApproval || false,
        friendsOnly:         friendsOnly || false,
        minAgeRequired:      minAgeRequired  || 0,
        vibe:                vibe   || null,
        tags:                Array.isArray(tags) ? tags : [],
        emoji:               emoji  || null,
        isSponsored:         isSponsored || false,
      });
      await doc.save();
      savedMongoId = doc._id;
      console.log(`🌍 MONGODB: Yeni Aktivite → "${title}" (userId: ${userId})`);
    } catch (dbErr) {
      console.log("MongoDB Kayıt Hatası:", dbErr.message);
    }
  }

  // ── JSON fallback ──────────────────────────────────────────────────────────
  const newActivity = {
    id:                    savedMongoId ? savedMongoId.toString() : ('act_' + Math.random().toString(36).substr(2, 9)),
    author, userId, title, content,
    category:              category || "Genel",
    location:              { latitude: latitude || 0, longitude: longitude || 0, addressText: addressText || "Bilinmiyor" },
    participants:          [userId],
    pendingParticipants:   [],
    confirmedParticipants: [],
    maxParticipants:       maxParticipants || 10,
    startTime:             startTime   || new Date().toISOString(),
    endTime:               endTime     || null,
    duration:              duration    || null,
    status:                'upcoming',
    isPrivate:             isPrivate   || false,
    password:              password    || null,
    requiresApproval:      requiresApproval || false,
    friendsOnly:           friendsOnly || false,
    minAgeRequired:        minAgeRequired  || 0,
    vibe:                  vibe   || null,
    tags:                  Array.isArray(tags) ? tags : [],
    emoji:                 emoji  || null,
    isSponsored:           isSponsored || false,
    createdAt:             new Date().toISOString(),
  };

  activities.push(newActivity);
  saveActivities();
  updateStreakForUser(userId);

  res.status(201).json({ message: "Aktivite paylaşıldı!", activity: newActivity });
});

// 2. NEARBY FEED
app.get('/api/activities/nearby', async (req, res) => {
  const { lat, lng, radius = 50 } = req.query;

  if (mongoose.connection.readyState === 1 && ActivityModel) {
    try {
      const docs = await ActivityModel.aggregate([
        {
          $geoNear: {
            near:          { type: "Point", coordinates: [parseFloat(lng), parseFloat(lat)] },
            distanceField: "distanceInMeters",
            maxDistance:   parseInt(radius) * 1000,
            spherical:     true
          }
        },
        { $match: { isPrivate: { $ne: true } } }
      ]);
      return res.status(200).json(docs.map(d => formatActivity(d, d.distanceInMeters)));
    } catch (dbErr) {
      console.log("Nearby hatası:", dbErr.message);
      return res.status(500).json({ message: "Veritabanı hatası" });
    }
  }

  // JSON fallback
  res.status(200).json(activities.filter(a => !a.isPrivate));
});

// 3. USER ACTIVITIES
app.get('/api/activities/user-activities/:userId', async (req, res) => {
  const { userId } = req.params;

  if (mongoose.connection.readyState === 1 && ActivityModel) {
    try {
      const docs = await ActivityModel.find({ participants: userId }).sort({ createdAt: -1 });
      return res.status(200).json(docs.map(d => formatActivity(d)));
    } catch (dbErr) {
      return res.status(500).json({ message: "Veritabanı okuma hatası!" });
    }
  }

  res.status(200).json(activities.filter(a => a.participants && a.participants.includes(userId)));
});

// 4. JOIN
app.post('/api/activities/join', async (req, res) => {
  const { activityId, userId, providedPassword } = req.body;
  if (!activityId || !userId) return res.status(400).json({ message: "Aktivite ID ve Kullanıcı ID gerekli!" });

  // ── MongoDB ──────────────────────────────────────────────────────────────
  if (mongoose.connection.readyState === 1 && ActivityModel) {
    try {
      const activity = await ActivityModel.findById(activityId);
      if (activity) {
        if (activity.isPrivate && activity.password !== providedPassword)
          return res.status(401).json({ message: "Yanlış şifre!" });
        if (activity.participants.length >= activity.maxParticipants)
          return res.status(400).json({ message: "Kontenjan dolu!" });
        if (activity.participants.includes(userId))
          return res.status(400).json({ message: "Zaten katıldınız!" });

        if (activity.requiresApproval) {
          if (!activity.pendingParticipants.includes(userId)) {
            activity.pendingParticipants.push(userId);
            await activity.save();
          }
          return res.status(200).json({ message: "Onay isteği kurucuya gönderildi!", status: "pending" });
        }

        activity.participants.push(userId);
        await activity.save();
        updateStreakForUser(userId);
        return res.status(200).json({ message: "Aktiviteye başarıyla katıldınız!", activity: formatActivity(activity) });
      }
    } catch (err) { console.log("Join hatası:", err.message); }
  }

  // ── JSON fallback ────────────────────────────────────────────────────────
  const actIndex = activities.findIndex(a => a.id === activityId || a._id === activityId);
  if (actIndex === -1) return res.status(404).json({ message: "Aktivite bulunamadı!" });

  const act = activities[actIndex];
  if (act.isPrivate && act.password !== providedPassword)
    return res.status(401).json({ message: "Yanlış şifre!" });
  if (act.participants.length >= act.maxParticipants)
    return res.status(400).json({ message: "Kontenjan dolu!" });
  if (act.participants.includes(userId))
    return res.status(400).json({ message: "Zaten katıldınız!" });

  if (act.requiresApproval) {
    if (!act.pendingParticipants) act.pendingParticipants = [];
    if (!act.pendingParticipants.includes(userId)) act.pendingParticipants.push(userId);
    saveActivities();
    return res.status(200).json({ message: "Onay isteği gönderildi!", status: "pending" });
  }

  act.participants.push(userId);
  saveActivities();
  updateStreakForUser(userId);
  return res.status(200).json({ message: "Aktiviteye başarıyla katıldınız!", activity: act });
});

// 5. LEAVE
app.post('/api/activities/leave', async (req, res) => {
  const { activityId, userId } = req.body;
  if (!activityId || !userId) return res.status(400).json({ message: "Aktivite ID ve Kullanıcı ID gerekli!" });

  if (mongoose.connection.readyState === 1 && ActivityModel) {
    try {
      const activity = await ActivityModel.findById(activityId);
      if (activity) {
        if (activity.userId === userId)
          return res.status(400).json({ message: "Kendi oluşturduğunuz aktiviteden ayrılamazsınız." });
        activity.participants = activity.participants.filter(id => id !== userId);
        await activity.save();
        return res.status(200).json({ message: "Aktiviteden ayrıldınız.", activity: formatActivity(activity) });
      }
    } catch (err) { console.log("Leave hatası:", err.message); }
  }

  const actIndex = activities.findIndex(a => a.id === activityId || a._id === activityId);
  if (actIndex === -1) return res.status(404).json({ message: "Aktivite bulunamadı!" });

  const act = activities[actIndex];
  if (act.userId === userId)
    return res.status(400).json({ message: "Kendi aktivitenizden ayrılamazsınız." });
  act.participants = act.participants.filter(id => id !== userId);
  saveActivities();
  return res.status(200).json({ message: "Aktiviteden ayrıldınız.", activity: act });
});

// 6. UPDATE
app.put('/api/activities/update/:id', async (req, res) => {
  const { id } = req.params;
  const { userId, title, content, category, maxParticipants, vibe, tags, emoji } = req.body;

  if (mongoose.connection.readyState === 1 && ActivityModel) {
    try {
      const activity = await ActivityModel.findById(id);
      if (activity) {
        if (activity.userId !== userId)
          return res.status(403).json({ message: "Bu aktiviteyi düzenleme yetkiniz yok!" });
        if (title)          activity.title          = title;
        if (content)        activity.content        = content;
        if (category)       activity.category       = category;
        if (maxParticipants) activity.maxParticipants = maxParticipants;
        if (vibe  !== undefined) activity.vibe  = vibe;
        if (emoji !== undefined) activity.emoji = emoji;
        if (Array.isArray(tags)) activity.tags  = tags;
        await activity.save();
        return res.status(200).json({ message: "Aktivite güncellendi!", activity: formatActivity(activity) });
      }
    } catch (err) { console.log("Update hatası:", err.message); }
  }

  const actIndex = activities.findIndex(a => a.id === id || a._id === id);
  if (actIndex === -1) return res.status(404).json({ message: "Aktivite bulunamadı!" });

  const act = activities[actIndex];
  if (act.userId !== userId) return res.status(403).json({ message: "Bu aktiviteyi düzenleme yetkiniz yok!" });
  if (title)          act.title          = title;
  if (content)        act.content        = content;
  if (category)       act.category       = category;
  if (maxParticipants) act.maxParticipants = maxParticipants;
  if (vibe  !== undefined) act.vibe  = vibe;
  if (emoji !== undefined) act.emoji = emoji;
  if (Array.isArray(tags)) act.tags  = tags;
  saveActivities();
  return res.status(200).json({ message: "Aktivite güncellendi!", activity: act });
});

// 7. KICK
app.post('/api/activities/kick', async (req, res) => {
  const { activityId, requesterId, targetId } = req.body;
  if (!activityId || !requesterId || !targetId)
    return res.status(400).json({ message: "Eksik bilgi!" });

  if (mongoose.connection.readyState === 1 && ActivityModel) {
    try {
      const activity = await ActivityModel.findById(activityId);
      if (activity && activity.userId === requesterId && requesterId !== targetId) {
        activity.participants = activity.participants.filter(id => id !== targetId);
        await activity.save();
        return res.status(200).json({ message: "Kullanıcı başarıyla atıldı." });
      }
    } catch (err) { console.log("Kick hatası:", err.message); }
  }

  const actIndex = activities.findIndex(a => a.id === activityId || a._id === activityId);
  if (actIndex === -1) return res.status(404).json({ message: "Aktivite bulunamadı!" });

  const act = activities[actIndex];
  if (act.userId !== requesterId || requesterId === targetId)
    return res.status(400).json({ message: "İşlem başarısız veya yetkisiz." });
  act.participants = act.participants.filter(id => id !== targetId);
  saveActivities();
  return res.status(200).json({ message: "Kullanıcı başarıyla atıldı." });
});

// 8. APPROVE PENDING PARTICIPANT
app.post('/api/activities/approve', async (req, res) => {
  const { activityId, requesterId, targetId } = req.body;
  if (!activityId || !requesterId || !targetId)
    return res.status(400).json({ message: "Eksik bilgi!" });

  if (mongoose.connection.readyState === 1 && ActivityModel) {
    try {
      const activity = await ActivityModel.findById(activityId);
      if (activity && activity.userId === requesterId) {
        if (!activity.pendingParticipants.includes(targetId))
          return res.status(400).json({ message: "Bu kullanıcının bekleyen isteği yok." });
        if (activity.participants.length >= activity.maxParticipants)
          return res.status(400).json({ message: "Kontenjan dolu!" });
        activity.pendingParticipants = activity.pendingParticipants.filter(id => id !== targetId);
        activity.participants.push(targetId);
        await activity.save();
        return res.status(200).json({ message: "Katılım onaylandı.", activity: formatActivity(activity) });
      }
    } catch (err) { console.log("Approve hatası:", err.message); }
  }

  const actIndex = activities.findIndex(a => a.id === activityId || a._id === activityId);
  if (actIndex === -1) return res.status(404).json({ message: "Aktivite bulunamadı!" });

  const act = activities[actIndex];
  if (act.userId !== requesterId)
    return res.status(403).json({ message: "Yetkisiz işlem." });
  if (!act.pendingParticipants || !act.pendingParticipants.includes(targetId))
    return res.status(400).json({ message: "Bekleyen istek yok." });
  if (act.participants.length >= act.maxParticipants)
    return res.status(400).json({ message: "Kontenjan dolu!" });
  act.pendingParticipants = act.pendingParticipants.filter(id => id !== targetId);
  act.participants.push(targetId);
  saveActivities();
  return res.status(200).json({ message: "Katılım onaylandı.", activity: act });
});

// 9. REJECT PENDING PARTICIPANT
app.post('/api/activities/reject', async (req, res) => {
  const { activityId, requesterId, targetId } = req.body;
  if (!activityId || !requesterId || !targetId)
    return res.status(400).json({ message: "Eksik bilgi!" });

  if (mongoose.connection.readyState === 1 && ActivityModel) {
    try {
      const activity = await ActivityModel.findById(activityId);
      if (activity && activity.userId === requesterId) {
        activity.pendingParticipants = activity.pendingParticipants.filter(id => id !== targetId);
        await activity.save();
        return res.status(200).json({ message: "İstek reddedildi." });
      }
    } catch (err) { console.log("Reject hatası:", err.message); }
  }

  const actIndex = activities.findIndex(a => a.id === activityId || a._id === activityId);
  if (actIndex === -1) return res.status(404).json({ message: "Aktivite bulunamadı!" });

  const act = activities[actIndex];
  if (act.userId !== requesterId) return res.status(403).json({ message: "Yetkisiz işlem." });
  if (act.pendingParticipants) act.pendingParticipants = act.pendingParticipants.filter(id => id !== targetId);
  saveActivities();
  return res.status(200).json({ message: "İstek reddedildi." });
});

// 10. CONFIRM ATTENDANCE
app.post('/api/activities/confirm-attendance', async (req, res) => {
  const { activityId, userId } = req.body;
  if (!activityId || !userId) return res.status(400).json({ message: "Eksik bilgi!" });

  if (mongoose.connection.readyState === 1 && ActivityModel) {
    try {
      const activity = await ActivityModel.findById(activityId);
      if (!activity) return res.status(404).json({ message: "Aktivite bulunamadı!" });
      if (!activity.participants.includes(userId)) return res.status(403).json({ message: "Bu aktivitenin katılımcısı değilsiniz." });
      if (!activity.confirmedParticipants.includes(userId)) {
        activity.confirmedParticipants.push(userId);
        await activity.save();
      }
      return res.status(200).json({ message: "Katılım onaylandı!", activity: formatActivity(activity) });
    } catch (err) { return res.status(500).json({ message: err.message }); }
  }

  const act = activities.find(a => a.id === activityId);
  if (!act) return res.status(404).json({ message: "Aktivite bulunamadı!" });
  if (!act.confirmedParticipants) act.confirmedParticipants = [];
  if (!act.confirmedParticipants.includes(userId)) {
    act.confirmedParticipants.push(userId);
    saveActivities();
  }
  return res.status(200).json({ message: "Katılım onaylandı!", activity: act });
});

// 11. GO LIVE (owner action)
app.post('/api/activities/go-live', async (req, res) => {
  const { activityId, userId } = req.body;
  if (!activityId || !userId) return res.status(400).json({ message: "Eksik bilgi!" });

  if (mongoose.connection.readyState === 1 && ActivityModel) {
    try {
      const activity = await ActivityModel.findById(activityId);
      if (!activity) return res.status(404).json({ message: "Aktivite bulunamadı!" });
      if (activity.userId !== userId) return res.status(403).json({ message: "Yetki yok!" });
      activity.status = 'live';
      await activity.save();
      return res.status(200).json({ message: "Aktivite canlıya alındı!", activity: formatActivity(activity) });
    } catch (err) { return res.status(500).json({ message: err.message }); }
  }

  const act = activities.find(a => a.id === activityId);
  if (!act) return res.status(404).json({ message: "Aktivite bulunamadı!" });
  if (act.userId !== userId) return res.status(403).json({ message: "Yetki yok!" });
  act.status = 'live';
  saveActivities();
  return res.status(200).json({ message: "Aktivite canlıya alındı!", activity: act });
});

// 12. END ACTIVITY (owner action)
app.post('/api/activities/end', async (req, res) => {
  const { activityId, userId } = req.body;
  if (!activityId || !userId) return res.status(400).json({ message: "Eksik bilgi!" });

  if (mongoose.connection.readyState === 1 && ActivityModel) {
    try {
      const activity = await ActivityModel.findById(activityId);
      if (!activity) return res.status(404).json({ message: "Aktivite bulunamadı!" });
      if (activity.userId !== userId) return res.status(403).json({ message: "Yetki yok!" });
      activity.status = 'ended';
      activity.endTime = new Date();
      await activity.save();
      const confirmed = activity.confirmedParticipants?.length
        ? activity.confirmedParticipants
        : activity.participants;
      if (confirmed?.length) awardXpToParticipants(confirmed.map(String), XP_PER_ACTIVITY);
      return res.status(200).json({ message: "Aktivite sonlandırıldı!", activity: formatActivity(activity) });
    } catch (err) { return res.status(500).json({ message: err.message }); }
  }

  const act = activities.find(a => a.id === activityId);
  if (!act) return res.status(404).json({ message: "Aktivite bulunamadı!" });
  if (act.userId !== userId) return res.status(403).json({ message: "Yetki yok!" });
  act.status = 'ended';
  act.endTime = new Date().toISOString();
  saveActivities();
  // Award XP to everyone who confirmed attendance
  const confirmed = act.confirmedParticipants || act.participants || [];
  if (confirmed.length > 0) awardXpToParticipants(confirmed, XP_PER_ACTIVITY);
  return res.status(200).json({ message: "Aktivite sonlandırıldı!", activity: act });
});

// 13. PENDING CONFIRMATIONS for a user
app.get('/api/activities/pending-confirmations/:userId', async (req, res) => {
  const { userId } = req.params;

  if (mongoose.connection.readyState === 1 && ActivityModel) {
    try {
      const docs = await ActivityModel.find({
        status: { $in: ['confirming', 'live'] },
        participants: userId,
        confirmedParticipants: { $ne: userId },
      });
      return res.status(200).json(docs.map(d => formatActivity(d)));
    } catch (err) { return res.status(500).json({ message: err.message }); }
  }

  const pending = activities.filter(a =>
    (a.status === 'confirming' || a.status === 'live') &&
    a.participants?.includes(userId) &&
    !a.confirmedParticipants?.includes(userId)
  );
  return res.status(200).json(pending.map(a => formatActivity(a)));
});

// =============================================================================
// 📸 MOMENTS
// =============================================================================

// GET  /api/activities/:id/moments — fetch moments for a live activity
app.get('/api/activities/:id/moments', async (req, res) => {
  const { id } = req.params;
  if (mongoose.connection.readyState === 1 && ActivityModel) {
    try {
      const act = await ActivityModel.findById(id).select('moments status');
      if (!act) return res.status(404).json({ message: 'Plan bulunamadı' });
      return res.status(200).json({ moments: act.moments || [], status: act.status });
    } catch (err) { return res.status(500).json({ message: err.message }); }
  }
  return res.status(200).json({ moments: [] });
});

// POST /api/activities/:id/moments — upload a photo moment (multipart/form-data)
app.post('/api/activities/:id/moments', upload.single('image'), async (req, res) => {
  const { id } = req.params;
  const { userId, username } = req.body;

  if (!req.file)   return res.status(400).json({ message: 'Fotoğraf gerekli' });
  if (!userId)     return res.status(400).json({ message: 'userId gerekli' });

  const imageUrl = `${BASE_URL}/uploads/${req.file.filename}`;
  const moment   = { userId, username: username || userId, imageUrl, timestamp: new Date() };

  if (mongoose.connection.readyState === 1 && ActivityModel) {
    try {
      const act = await ActivityModel.findById(id);
      if (!act) return res.status(404).json({ message: 'Plan bulunamadı' });
      if (act.status !== 'live') return res.status(400).json({ message: 'Plan canlıda değil' });

      act.moments = act.moments || [];
      act.moments.push(moment);
      await act.save();
      return res.status(201).json({ moment, totalMoments: act.moments.length });
    } catch (err) { return res.status(500).json({ message: err.message }); }
  }

  return res.status(201).json({ moment, totalMoments: 1 });
});

// =============================================================================
// 👑 ADMIN
// =============================================================================
app.get('/api/admin/stats', async (req, res) => {
  if (req.query.adminKey !== "zona_super_admin_2026")
    return res.status(403).json({ message: "Erişim Reddedildi." });

  let totalActivities = activities.length;
  if (mongoose.connection.readyState === 1 && ActivityModel) {
    try { totalActivities = await ActivityModel.countDocuments(); } catch {}
  }

  res.status(200).json({
    totalUsers:       users.length,
    totalActivities,
    activeSocketsNow: io.engine.clientsCount,
    systemTime:       new Date().toISOString()
  });
});

// =============================================================================
// 🔐 AUTH & PROFILE
// =============================================================================
app.post('/api/social-login', (req, res) => {
  const { email, username, provider } = req.body;
  if (!email) return res.status(400).json({ message: "Geçersiz sosyal medya verisi!" });

  const identifier = email.toLowerCase();
  let user = users.find(u => u.email && u.email.toLowerCase() === identifier);

  if (user) {
    console.log(`✅ Sosyal Login: ${user.username} (${provider})`);
    return res.status(200).json({ message: "Giriş başarılı!", user });
  }

  const newUser = {
    id: generateUniqueID(),
    username: (username || "User").replace(/\s+/g, '') + Math.floor(100 + Math.random() * 900),
    email: identifier,
    password: `social_auth_${provider}`,
    authType: provider,
    isSocial: true,
    isEmailVerified: true,
    bio: `${provider} üzerinden katıldı!`,
    location: "", district: "", zodiac: "", instagram: "", tiktok: "",
    profilePic: `${BASE_URL}/uploads/default_pp.png`,
    banner:     `${BASE_URL}/uploads/default_banner.png`,
    createdAt:  new Date().toISOString()
  };
  users.push(newUser);
  saveUsers();
  console.log(`✨ Sosyal Kayıt: ${newUser.username} (${provider})`);
  return res.status(201).json({ message: "Sosyal hesap oluşturuldu!", user: newUser });
});

app.post('/api/signup', (req, res) => {
  const { username, password, authType } = req.body;
  if (!username) return res.status(400).json({ message: "Kullanıcı adı gerekli!" });

  const identifier = username.toLowerCase();
  const isTaken = users.some(u =>
    (u.email && u.email.toLowerCase() === identifier) ||
    (u.username && u.username.toLowerCase() === identifier)
  );
  if (isTaken) return res.status(400).json({ message: "Bu kullanıcı zaten mevcut!" });

  if (authType === "email") {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    pendingUsers[identifier] = {
      username, password, authType: "local", isSocial: false,
      code, expires: Date.now() + 10 * 60 * 1000
    };
    transporter.sendMail({
      from: '"ZONA Support" <zonaauth@gmail.com>',
      to: username,
      subject: `${code} - ZONA Doğrulama Kodun`,
      html: `<div style="text-align:center;"><h1>Onay Kodun: ${code}</h1></div>`
    });
    return res.status(201).json({ message: "Kod gönderildi!", requiresVerification: true });
  }

  const newUser = {
    id: generateUniqueID(), username, email: "", password,
    authType: "local", isSocial: false, isEmailVerified: false, bio: "Selam!",
    location: "", district: "", zodiac: "", instagram: "", tiktok: "",
    profilePic: `${BASE_URL}/uploads/default_pp.png`,
    banner:     `${BASE_URL}/uploads/default_banner.png`,
    createdAt:  new Date().toISOString()
  };
  users.push(newUser);
  saveUsers();
  res.status(201).json({ message: "Kayıt başarılı!", user: newUser, requiresVerification: false });
});

app.post('/api/user/verify-email', (req, res) => {
  const { identifier, code } = req.body;
  if (!identifier) return res.status(400).json({ message: "Geçersiz istek!" });

  const emailKey = identifier.toLowerCase();
  const pending  = pendingUsers[emailKey];

  if (pending && pending.code === code) {
    const newUser = {
      id: generateUniqueID(), username: pending.username, email: pending.username,
      password: pending.password, authType: "local", isSocial: false, isEmailVerified: true,
      bio: "Selam!", location: "", district: "", zodiac: "", instagram: "", tiktok: "",
      profilePic: `${BASE_URL}/uploads/default_pp.png`,
      banner:     `${BASE_URL}/uploads/default_banner.png`,
      createdAt:  new Date().toISOString()
    };
    users.push(newUser);
    saveUsers();
    delete pendingUsers[emailKey];
    return res.status(200).json({ message: "E-posta doğrulandı!", user: newUser });
  }
  return res.status(400).json({ message: "Girdiğin kod hatalı veya süresi dolmuş!" });
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "Dosya yüklenemedi!" });
  res.status(200).json({ url: `${BASE_URL}/uploads/${req.file.filename}` });
});

app.post('/api/login', (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) return res.status(400).json({ message: "Eksik bilgi!" });

  const user = users.find(u =>
    ((u.username && u.username === identifier) || (u.email && u.email === identifier)) &&
    u.password === password
  );
  if (!user) return res.status(401).json({ message: "Hatalı kullanıcı adı veya şifre!" });
  console.log(`🔑 Yerel Giriş: ${user.username}`);
  res.status(200).json({ user });
});

app.get('/api/user/:username', (req, res) => {
  const user = users.find(u =>
    u.username === req.params.username ||
    (u.email && u.email === req.params.username)
  );
  if (!user) return res.status(404).json({ message: "Kullanıcı bulunamadı" });
  res.json(user);
});

app.post('/api/user/send-update-code', (req, res) => {
  const { username, email } = req.body;
  const identifier = email.toLowerCase();

  if (users.some(u => u.email && u.email.toLowerCase() === identifier && u.username !== username))
    return res.status(400).json({ message: "Bu e-posta adresi zaten kullanımda!" });

  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  pendingUsers[identifier] = { username, code, newEmail: identifier };
  transporter.sendMail({
    from: '"ZONA Support" <zonaauth@gmail.com>',
    to: email,
    subject: `${code} - ZONA E-posta Onay Kodun`,
    html: `<div style="text-align:center;"><h1>Onay Kodun: ${code}</h1><p>Profilini güncellemek için bu kodu kullan.</p></div>`
  });
  res.status(200).json({ message: "Kod gönderildi!" });
});

app.post('/api/user/verify-update-code', (req, res) => {
  const { username, email, code } = req.body;
  const identifier = email.toLowerCase();
  const pending    = pendingUsers[identifier];

  if (pending && pending.code === code && pending.username === username) {
    const userIndex = users.findIndex(u => u.username === username);
    if (userIndex !== -1) {
      users[userIndex].email = pending.newEmail;
      saveUsers();
      delete pendingUsers[identifier];
      return res.status(200).json({ message: "E-posta başarıyla eklendi!" });
    }
  }
  res.status(400).json({ message: "Geçersiz veya süresi dolmuş kod!" });
});

app.post('/api/user/change-password', (req, res) => {
  const { username, email, code, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6)
    return res.status(400).json({ message: 'Şifre en az 6 karakter olmalı.' });

  const identifier = email.toLowerCase();
  const pending = pendingUsers[identifier];

  if (!pending || pending.code !== code || pending.username !== username)
    return res.status(400).json({ message: 'Geçersiz veya süresi dolmuş kod!' });

  const userIndex = users.findIndex(u => u.username === username);
  if (userIndex === -1) return res.status(404).json({ message: 'Kullanıcı bulunamadı.' });

  users[userIndex].password = newPassword;
  saveUsers();
  delete pendingUsers[identifier];
  res.status(200).json({ message: 'Şifre değiştirildi.' });
});

app.delete('/api/user/:userId', async (req, res) => {
  const { userId } = req.params;
  const idx = users.findIndex(u => u.id === userId);
  if (idx === -1) return res.status(404).json({ message: 'Kullanıcı bulunamadı.' });

  users.splice(idx, 1);
  saveUsers();

  // Remove user's activities from MongoDB too
  try {
    if (mongoose.connection.readyState === 1 && ActivityModel) {
      await ActivityModel.deleteMany({ userId });
    }
  } catch (_) {}

  res.status(200).json({ message: 'Hesap silindi.' });
});

app.post('/api/user/update', (req, res) => {
  const {
    currentIdentifier, newUsername, bio, profilePic, banner,
    email, location, district, zodiac, instagram, tiktok, interests
  } = req.body;

  if (email && users.some(u =>
    u.email && u.email.toLowerCase() === email.toLowerCase() &&
    u.username !== currentIdentifier
  )) return res.status(400).json({ message: "Bu e-posta adresi zaten kullanımda!" });

  const userIndex = users.findIndex(u =>
    u.username === currentIdentifier || (u.email && u.email === currentIdentifier)
  );
  if (userIndex === -1) return res.status(404).json({ message: "Kullanıcı bulunamadı!" });

  const u = users[userIndex];
  if (newUsername)          u.username   = newUsername;
  if (bio        !== undefined) u.bio        = bio;
  if (profilePic !== undefined) u.profilePic = profilePic;
  if (banner     !== undefined) u.banner     = banner;
  if (email)                u.email      = email.toLowerCase();
  if (location   !== undefined) u.location   = location;
  if (district   !== undefined) u.district   = district;
  if (zodiac     !== undefined) u.zodiac     = zodiac;
  if (instagram  !== undefined) u.instagram  = instagram;
  if (tiktok     !== undefined) u.tiktok     = tiktok;
  if (interests  !== undefined) u.interests  = interests;

  saveUsers();
  res.status(200).json({ message: "Profil güncellendi!", user: u });
});

// ─── User Stats & Badges ──────────────────────────────────────────────────────
app.get('/api/user/stats/:userId', (req, res) => {
  const user = users.find(u => u.id === req.params.userId);
  if (!user) return res.status(404).json({ message: "Kullanıcı bulunamadı" });
  const completed = user.activitiesCompleted || 0;
  const xp = user.xp || 0;
  const earnedBadgeIds = user.badges || computeBadges(completed);
  const badges = BADGE_TIERS.map(b => ({
    ...b,
    earned: earnedBadgeIds.includes(b.id),
  }));
  const nextTier = BADGE_TIERS.find(b => completed < b.minActivities);
  res.json({
    xp,
    activitiesCompleted: completed,
    badges,
    nextBadge: nextTier ? {
      name: nextTier.name,
      emoji: nextTier.emoji,
      remaining: nextTier.minActivities - completed,
    } : null,
  });
});

// =============================================================================
// 👻 PHANTOM PINGS
// =============================================================================

app.post('/api/pings/create', async (req, res) => {
  const { userId, text, latitude, longitude } = req.body;
  if (!userId || !text || !latitude || !longitude)
    return res.status(400).json({ message: "Eksik bilgi" });
  if (!PingModel) return res.status(503).json({ message: "Servis hazır değil" });

  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 60 min
  try {
    const ping = new PingModel({
      creatorId:  userId,
      text:       text.trim().substring(0, 100),
      location:   { type: 'Point', coordinates: [parseFloat(longitude), parseFloat(latitude)] },
      expiresAt,
    });
    await ping.save();
    res.status(201).json({
      id: ping._id,
      text: ping.text,
      expiresAt: ping.expiresAt,
      latitude,
      longitude,
    });
  } catch (err) {
    res.status(500).json({ message: "Ping oluşturulamadı", error: err.message });
  }
});

app.get('/api/pings/nearby', async (req, res) => {
  const { lat, lng, radius = 5 } = req.query; // km, default 5
  if (!PingModel) return res.status(200).json([]);
  try {
    const pings = await PingModel.aggregate([
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
          distanceField: 'distanceInMeters',
          maxDistance: parseFloat(radius) * 1000,
          spherical: true,
        },
      },
      { $match: { status: 'active' } },
    ]);
    const userId = req.query.userId;
    res.json(pings.map(p => ({
      id:            p._id,
      text:          p.text,
      latitude:      p.location.coordinates[1],
      longitude:     p.location.coordinates[0],
      distanceInKm:  (p.distanceInMeters / 1000).toFixed(2),
      interestedCount: p.interested.length,
      isMine:        p.creatorId === userId,
      isInterested:  p.interested.includes(userId),
      expiresAt:     p.expiresAt,
      status:        p.status,
    })));
  } catch (err) {
    res.status(500).json({ message: "Ping listesi alınamadı" });
  }
});

// Mine — shows full interested list so creator can lock in
app.get('/api/pings/mine', async (req, res) => {
  const { userId } = req.query;
  if (!userId || !PingModel) return res.status(200).json([]);
  try {
    const pings = await PingModel.find({ creatorId: userId, status: 'active' }).lean();
    res.json(pings.map(p => ({
      id:            p._id,
      text:          p.text,
      latitude:      p.location.coordinates[1],
      longitude:     p.location.coordinates[0],
      interestedCount: p.interested.length,
      expiresAt:     p.expiresAt,
    })));
  } catch (err) {
    res.status(500).json({ message: "Ping listesi alınamadı" });
  }
});

// Express interest (anyone except creator)
app.post('/api/pings/:id/interest', async (req, res) => {
  const { userId } = req.body;
  if (!userId || !PingModel) return res.status(400).json({ message: "Geçersiz" });
  try {
    const ping = await PingModel.findById(req.params.id);
    if (!ping || ping.status !== 'active')
      return res.status(404).json({ message: "Ping bulunamadı veya süresi doldu" });
    if (ping.creatorId === userId)
      return res.status(400).json({ message: "Kendi Ping'ine ilgi gösteremezsin" });
    if (!ping.interested.includes(userId)) {
      ping.interested.push(userId);
      await ping.save();
      // Notify creator via socket
      io.to(`user_${ping.creatorId}`).emit('ping_interest', { pingId: ping._id, interestedCount: ping.interested.length });
    }
    res.json({ message: "İlgin iletildi", interestedCount: ping.interested.length });
  } catch (err) {
    res.status(500).json({ message: "İşlem başarısız" });
  }
});

// Creator locks in — triggers match
app.post('/api/pings/:id/lock', async (req, res) => {
  const { creatorId } = req.body;
  if (!creatorId || !PingModel) return res.status(400).json({ message: "Geçersiz" });
  try {
    const ping = await PingModel.findById(req.params.id);
    if (!ping || ping.status !== 'active')
      return res.status(404).json({ message: "Ping bulunamadı" });
    if (ping.creatorId !== creatorId)
      return res.status(403).json({ message: "Yetkisiz" });
    if (ping.interested.length === 0)
      return res.status(400).json({ message: "Henüz ilgilenen yok" });

    const partnerId = ping.interested[0];
    const chatId = `ping_${ping._id}_${Date.now()}`;
    ping.status    = 'matched';
    ping.lockedPair = [creatorId, partnerId];
    ping.chatId    = chatId;
    await ping.save();

    const creatorUser = users.find(u => u.id === creatorId);
    const partnerUser = users.find(u => u.id === partnerId);

    // Notify both parties
    io.to(`user_${creatorId}`).emit('ping_matched', {
      chatId,
      partnerUsername: partnerUser?.username || 'Kullanıcı',
      partnerPic:      partnerUser?.profilePic || null,
      pingText:        ping.text,
    });
    io.to(`user_${partnerId}`).emit('ping_matched', {
      chatId,
      partnerUsername: creatorUser?.username || 'Kullanıcı',
      partnerPic:      creatorUser?.profilePic || null,
      pingText:        ping.text,
    });

    res.json({ message: "Eşleşildi!", chatId, partnerUsername: partnerUser?.username });
  } catch (err) {
    res.status(500).json({ message: "Eşleşme başarısız" });
  }
});

app.delete('/api/pings/:id', async (req, res) => {
  const { userId } = req.body;
  if (!PingModel) return res.status(200).json({ message: "Silindi" });
  try {
    const ping = await PingModel.findById(req.params.id);
    if (!ping) return res.status(404).json({ message: "Ping bulunamadı" });
    if (ping.creatorId !== userId) return res.status(403).json({ message: "Yetkisiz" });
    ping.status = 'cancelled';
    await ping.save();
    res.json({ message: "Ping silindi" });
  } catch (err) {
    res.status(500).json({ message: "Silinemedi" });
  }
});

// =============================================================================
// ⚡ ZERO-HOUR COLLECTIVES
// =============================================================================

app.post('/api/collectives/create', async (req, res) => {
  const { title, description, latitude, longitude, addressText, requiredCount, durationMinutes } = req.body;
  if (!title || !latitude || !longitude || !requiredCount)
    return res.status(400).json({ message: "Eksik bilgi" });
  if (!CollectiveModel) return res.status(503).json({ message: "Servis hazır değil" });

  const expiresAt = new Date(Date.now() + (parseInt(durationMinutes) || 60) * 60 * 1000);
  try {
    const col = new CollectiveModel({
      title,
      description: description || '',
      location: {
        type:        'Point',
        coordinates: [parseFloat(longitude), parseFloat(latitude)],
        addressText: addressText || 'Bilinmiyor',
      },
      requiredCount: parseInt(requiredCount),
      expiresAt,
    });
    await col.save();
    res.status(201).json(_formatCollective(col, 0));
  } catch (err) {
    res.status(500).json({ message: "Collective oluşturulamadı" });
  }
});

app.get('/api/collectives/nearby', async (req, res) => {
  const { lat, lng, radius = 10 } = req.query;
  if (!CollectiveModel) return res.status(200).json([]);
  try {
    const docs = await CollectiveModel.aggregate([
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
          distanceField: 'distanceInMeters',
          maxDistance: parseFloat(radius) * 1000,
          spherical: true,
        },
      },
      { $match: { status: { $in: ['seeding', 'active', 'unlocked'] } } },
    ]);
    res.json(docs.map(d => _formatCollective(d, d.distanceInMeters)));
  } catch (err) {
    res.status(500).json({ message: "Collective listesi alınamadı" });
  }
});

// User checks in (physically in radius)
app.post('/api/collectives/:id/checkin', async (req, res) => {
  const { userId } = req.body;
  if (!userId || !CollectiveModel) return res.status(400).json({ message: "Geçersiz" });
  try {
    const col = await CollectiveModel.findById(req.params.id);
    if (!col || col.status === 'unlocked' || col.status === 'failed')
      return res.status(404).json({ message: "Collective bulunamadı" });

    if (!col.checkedIn.includes(userId)) {
      col.checkedIn.push(userId);
      if (col.status === 'seeding') col.status = 'active';
      await col.save();
      io.emit('collective_update', _formatCollective(col, 0));
    }
    res.json(_formatCollective(col, 0));
  } catch (err) {
    res.status(500).json({ message: "Check-in başarısız" });
  }
});

// User presses "I'm In" to trigger simultaneous unlock attempt
app.post('/api/collectives/:id/ready', async (req, res) => {
  const { userId } = req.body;
  if (!userId || !CollectiveModel) return res.status(400).json({ message: "Geçersiz" });
  try {
    const col = await CollectiveModel.findById(req.params.id);
    if (!col || col.status === 'unlocked' || col.status === 'failed')
      return res.status(404).json({ message: "Collective bulunamadı" });

    if (!col.readyUsers.includes(userId)) col.readyUsers.push(userId);

    if (col.readyUsers.length >= col.requiredCount && col.status !== 'unlocked') {
      col.status     = 'unlocked';
      col.unlockedAt = new Date();
      await col.save();
      // Award XP + badge to all participants
      const allParticipants = [...new Set([...col.checkedIn, ...col.readyUsers])];
      awardXpToParticipants(allParticipants, 75);
      io.emit('collective_unlocked', { collectiveId: col._id, title: col.title, participants: allParticipants });
      return res.json({ status: 'unlocked', collective: _formatCollective(col, 0) });
    }

    await col.save();
    io.emit('collective_update', _formatCollective(col, 0));
    res.json({ status: 'waiting', readyCount: col.readyUsers.length, required: col.requiredCount });
  } catch (err) {
    res.status(500).json({ message: "İşlem başarısız" });
  }
});

const _formatCollective = (col, distanceInMeters) => ({
  id:            col._id,
  title:         col.title,
  description:   col.description,
  latitude:      col.location.coordinates[1],
  longitude:     col.location.coordinates[0],
  addressText:   col.location.addressText,
  radius:        col.radius,
  requiredCount: col.requiredCount,
  checkedInCount: col.checkedIn.length,
  readyCount:    col.readyUsers.length,
  status:        col.status,
  expiresAt:     col.expiresAt,
  unlockedAt:    col.unlockedAt,
  distanceInKm:  (distanceInMeters / 1000).toFixed(2),
});

// =============================================================================
// 🌑 TETHERED BLACKOUT — DARK ROOM
// =============================================================================

// Enable blackout mode when starting an activity
app.post('/api/activities/:id/blackout/enable', async (req, res) => {
  const { userId } = req.body;
  if (!ActivityModel) return res.status(503).json({ message: "Servis hazır değil" });
  try {
    const act = await ActivityModel.findById(req.params.id);
    if (!act) return res.status(404).json({ message: "Aktivite bulunamadı" });
    if (act.userId !== userId) return res.status(403).json({ message: "Yetkisiz" });
    act.blackoutMode = true;
    await act.save();
    io.to(req.params.id).emit('blackout_enabled', { activityId: req.params.id });
    res.json({ message: "Blackout modu aktif", blackoutMode: true });
  } catch (err) {
    res.status(500).json({ message: "Aktifleştirilemedi" });
  }
});

// Upload a dark room photo (locked until activity ends)
app.post('/api/activities/:id/darkroom', upload.single('image'), async (req, res) => {
  const { userId, username } = req.body;
  if (!req.file) return res.status(400).json({ message: "Görsel gerekli" });
  if (!ActivityModel) return res.status(503).json({ message: "Servis hazır değil" });

  const imageUrl = `${BASE_URL}/uploads/${req.file.filename}`;
  try {
    const act = await ActivityModel.findById(req.params.id);
    if (!act) return res.status(404).json({ message: "Aktivite bulunamadı" });
    if (act.status !== 'live') return res.status(400).json({ message: "Sadece canlı aktivitelerde karanlık oda kullanılabilir" });
    if (!act.blackoutMode) return res.status(400).json({ message: "Blackout modu aktif değil" });
    if (!act.participants.includes(userId)) return res.status(403).json({ message: "Katılımcı değilsiniz" });

    act.darkroomPhotos.push({ userId, username, imageUrl });
    await act.save();
    res.json({ message: "Fotoğraf karanlık odaya eklendi", count: act.darkroomPhotos.length });
  } catch (err) {
    res.status(500).json({ message: "Yükleme başarısız" });
  }
});

// Get dark room photos — only reveals if activity has ended
app.get('/api/activities/:id/darkroom', async (req, res) => {
  if (!ActivityModel) return res.status(200).json({ locked: true, photos: [] });
  try {
    const act = await ActivityModel.findById(req.params.id);
    if (!act) return res.status(404).json({ message: "Aktivite bulunamadı" });
    const { userId } = req.query;
    if (!act.participants.includes(userId))
      return res.status(403).json({ message: "Katılımcı değilsiniz" });

    if (act.status !== 'ended') {
      return res.json({
        locked:   true,
        photos:   [],
        count:    act.darkroomPhotos.length,
        status:   act.status,
      });
    }
    res.json({ locked: false, photos: act.darkroomPhotos, count: act.darkroomPhotos.length });
  } catch (err) {
    res.status(500).json({ message: "Dark room alınamadı" });
  }
});

// =============================================================================
// ⭐ RATING SYSTEM
// =============================================================================

// Rate an activity (1-5) — stored on the activity document
app.post('/api/activities/:id/rate', async (req, res) => {
  const { userId, score } = req.body;
  if (!userId || !score || score < 1 || score > 5)
    return res.status(400).json({ message: "Geçersiz puan (1-5)" });
  if (!ActivityModel) return res.status(503).json({ message: "Servis hazır değil" });
  try {
    const act = await ActivityModel.findById(req.params.id);
    if (!act) return res.status(404).json({ message: "Aktivite bulunamadı" });
    if (!act.participants.includes(userId))
      return res.status(403).json({ message: "Sadece katılımcılar puanlayabilir" });
    act.activityRatingSum   = (act.activityRatingSum   || 0) + parseInt(score);
    act.activityRatingCount = (act.activityRatingCount || 0) + 1;
    await act.save();
    const avg = (act.activityRatingSum / act.activityRatingCount).toFixed(1);
    res.json({ message: "Puan kaydedildi", avgRating: avg });
  } catch (err) {
    res.status(500).json({ message: "Puanlama başarısız" });
  }
});

// Rate a user after participating together — stored on user JSON
app.post('/api/user/:userId/rate', (req, res) => {
  const { raterId, score, activityId } = req.body;
  if (!raterId || !score || score < 1 || score > 5)
    return res.status(400).json({ message: "Geçersiz puan" });
  if (raterId === req.params.userId)
    return res.status(400).json({ message: "Kendini puanlayamazsın" });

  const target = users.find(u => u.id === req.params.userId);
  if (!target) return res.status(404).json({ message: "Kullanıcı bulunamadı" });

  // Prevent rating the same person twice for same activity
  if (!target.ratedInActivities) target.ratedInActivities = [];
  const dupeKey = `${raterId}_${activityId}`;
  if (target.ratedInActivities.includes(dupeKey))
    return res.status(409).json({ message: "Bu aktivite için zaten puanladın" });

  target.ratingSum   = (target.ratingSum   || 0) + parseInt(score);
  target.ratingCount = (target.ratingCount || 0) + 1;
  target.ratedInActivities.push(dupeKey);
  saveUsers();

  const avg = (target.ratingSum / target.ratingCount).toFixed(1);
  res.json({ message: "Puan kaydedildi", avgRating: avg });
});

// =============================================================================
// 🗃️ MEMORY CORNER — Past activities for a user
// =============================================================================

app.get('/api/activities/memories/:userId', async (req, res) => {
  const { userId } = req.params;
  if (!ActivityModel) return res.status(200).json([]);
  try {
    const docs = await ActivityModel.find({
      participants: userId,
      isArchived: true,
    }).sort({ createdAt: -1 }).limit(50).lean();
    res.json(docs.map(d => formatActivity(d)));
  } catch (err) {
    res.status(500).json({ message: "Anılar yüklenemedi" });
  }
});

// Public user profile (username or ID)
app.get('/api/user/public/:identifier', (req, res) => {
  const { identifier } = req.params;
  const user = users.find(u => u.id === identifier || u.username === identifier);
  if (!user) return res.status(404).json({ message: "Kullanıcı bulunamadı" });
  const avgRating = user.ratingCount > 0
    ? (user.ratingSum / user.ratingCount).toFixed(1)
    : null;
  res.json({
    id:          user.id,
    username:    user.username,
    bio:         user.bio || '',
    profilePic:  user.profilePic || null,
    banner:      user.banner || null,
    location:    user.location || '',
    district:    user.district || '',
    zodiac:      user.zodiac || '',
    instagram:   user.instagram || null,
    xp:          user.xp || 0,
    activitiesCompleted: user.activitiesCompleted || 0,
    badges:      user.badges || [],
    streakDays:  user.streakDays || 0,
    avgRating,
    ratingCount: user.ratingCount || 0,
  });
});

// ─── Follow / Unfollow ────────────────────────────────────────────────────────
app.post('/api/user/follow', (req, res) => {
  const { requesterId, targetId } = req.body;
  if (!requesterId || !targetId || requesterId === targetId)
    return res.status(400).json({ message: "Geçersiz istek" });

  const requester = users.find(u => u.id === requesterId);
  const target    = users.find(u => u.id === targetId);
  if (!requester || !target)
    return res.status(404).json({ message: "Kullanıcı bulunamadı" });

  if (!requester.following) requester.following = [];
  if (!target.followers)    target.followers    = [];

  if (!requester.following.includes(targetId)) requester.following.push(targetId);
  if (!target.followers.includes(requesterId)) target.followers.push(requesterId);

  saveUsers();
  res.json({ message: "Takip edildi" });
});

app.post('/api/user/unfollow', (req, res) => {
  const { requesterId, targetId } = req.body;
  const requester = users.find(u => u.id === requesterId);
  const target    = users.find(u => u.id === targetId);
  if (!requester || !target)
    return res.status(404).json({ message: "Kullanıcı bulunamadı" });

  requester.following = (requester.following || []).filter(id => id !== targetId);
  target.followers    = (target.followers    || []).filter(id => id !== requesterId);

  saveUsers();
  res.json({ message: "Takip bırakıldı" });
});

// ─── Friends Streaks Leaderboard ──────────────────────────────────────────────
app.get('/api/user/friends-streaks/:userId', (req, res) => {
  const user = users.find(u => u.id === req.params.userId);
  if (!user) return res.status(404).json({ message: "Kullanıcı bulunamadı" });

  const friendIds = [...new Set([...(user.following || []), ...(user.followers || [])])];
  const meEntry = {
    id:           user.id,
    username:     user.username,
    profilePic:   user.profilePic || null,
    streakDays:   user.streakDays || 0,
    longestStreak: user.longestStreak || 0,
    isMe:         true,
  };

  const friendEntries = friendIds
    .map(fid => users.find(u => u.id === fid))
    .filter(Boolean)
    .map(f => ({
      id:           f.id,
      username:     f.username,
      profilePic:   f.profilePic || null,
      streakDays:   f.streakDays || 0,
      longestStreak: f.longestStreak || 0,
      isMe:         false,
      isFollowing:  (user.following || []).includes(f.id),
    }));

  const board = [meEntry, ...friendEntries].sort((a, b) => b.streakDays - a.streakDays);
  res.json(board);
});

// ─── User Search ──────────────────────────────────────────────────────────────
app.get('/api/user/search', (req, res) => {
  const { q, requesterId } = req.query;
  if (!q || q.trim().length < 2)
    return res.status(400).json({ message: "En az 2 karakter girin" });

  const query = q.trim().toLowerCase();
  const requester = users.find(u => u.id === requesterId);
  const following = requester ? (requester.following || []) : [];

  const results = users
    .filter(u => u.id !== requesterId && u.username.toLowerCase().includes(query))
    .slice(0, 20)
    .map(u => ({
      id:          u.id,
      username:    u.username,
      profilePic:  u.profilePic || null,
      streakDays:  u.streakDays || 0,
      isFollowing: following.includes(u.id),
    }));

  res.json(results);
});

// =============================================================================
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Badyy Sunucusu (Socket.io + Cron) ${PORT} portunda hazır!`);
});