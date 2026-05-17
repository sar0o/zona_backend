const express = require('express');
const cors = require('cors');
const fs = require('fs');
const nodemailer = require('nodemailer');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const mongoose = require('mongoose');

// 🔥 YENİ: Gerçek zamanlı sohbet (Chat) ve Harita için Socket.io
const http = require('http');
const { Server } = require('socket.io');

let ActivityModel;
try {
    ActivityModel = require('./models/Activity'); 
} catch (err) {
    console.log("⚠️ Activity.js dosyası bulunamadı.");
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = 3000;

const USERS_FILE = './users.json';
const ACTIVITIES_FILE = './activities.json'; 

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// MongoDB Bağlantısı
mongoose.connect('mongodb+srv://BadyySarp:roqso7-kedpof-vyQxuf@badyy.dropkeo.mongodb.net/?appName=Badyy')
  .then(() => console.log("✅ MongoDB Bağlantısı Başarılı!"))
  .catch(err => console.log("⚠️ MongoDB Hatası:", err.message));

// Veritabanı Yükleme İşlemleri
let users = [];
if (fs.existsSync(USERS_FILE)) {
    try { users = JSON.parse(fs.readFileSync(USERS_FILE)); } catch (err) { users = []; }
}
const saveUsers = () => fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

let activities = [];
if (fs.existsSync(ACTIVITIES_FILE)) {
    try { activities = JSON.parse(fs.readFileSync(ACTIVITIES_FILE)); } catch (err) { activities = []; }
}
const saveActivities = () => fs.writeFileSync(ACTIVITIES_FILE, JSON.stringify(activities, null, 2));

const pendingUsers = {}; 

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: 'zonaauth@gmail.com', pass: 'jhbf ekeo dggr jgnq' }
});

const generateUniqueID = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    while (true) {
        result = 'user_'; 
        for (let i = 0; i < 10; i++) { result += chars.charAt(Math.floor(Math.random() * chars.length)); }
        if (!users.some(u => u.id === result)) break;
    }
    return result;
};

// ===================================================================================
// 🧹 SÜPÜRGE MOTORU (CRON JOB) - SÜRESİ DOLANLARI OTOMATİK SİL
// ===================================================================================
setInterval(async () => {
    const now = new Date();
    let cleaned = false;

    // JSON Temizliği
    activities = activities.filter(act => {
        if (!act.endTime) return true; // Bitiş saati yoksa kalır
        const end = new Date(act.endTime);
        if (end < now) { cleaned = true; return false; } // Süresi dolmuşsa sil
        return true;
    });

    if (cleaned) {
        saveActivities();
        console.log(`🧹 Sistem Temizliği: Süresi dolan aktiviteler JSON'dan silindi.`);
    }

    // MONGODB Temizliği
    if (mongoose.connection.readyState === 1 && ActivityModel) {
        try {
            const result = await ActivityModel.deleteMany({ endTime: { $lt: now } });
            if (result.deletedCount > 0) console.log(`🧹 MongoDB Temizliği: ${result.deletedCount} aktivite silindi.`);
        } catch (err) {}
    }
}, 1000 * 60 * 60); // Her saat başı çalışır

// ===================================================================================
// 💬 SOCKET.IO SİSTEMİ (CHAT & CANLI HARİTA İÇİN ALTYAPI)
// ===================================================================================
io.on('connection', (socket) => {
    console.log(`🟢 Yeni Bağlantı: ${socket.id}`);

    socket.on('join_room', (roomId) => {
        socket.join(roomId);
        console.log(`Kullanıcı odaya katıldı: ${roomId}`);
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

// ===================================================================================
// AKTİVİTE MOTORU (İLERİKİ ÖZELLİKLERİN ALTYAPISIYLA BERABER)
// ===================================================================================

// 1. AKTİVİTE OLUŞTURMA
app.post('/api/activities/create', async (req, res) => {
    // 🔥 Gelecekteki özellikler için altyapı eklendi (startTime, endTime, isPrivate vb.)
    const { 
        author, userId, title, content, category, latitude, longitude, addressText, 
        maxParticipants, startTime, endTime, isPrivate, password, isSponsored, requiresApproval 
    } = req.body;

    if (!author || !userId || !title || !content) { 
        return res.status(400).json({ message: "Yazar, ID, Başlık ve İçerik zorunludur!" });
    }

    if (mongoose.connection.readyState === 1 && ActivityModel) {
        try {
            const newMongoActivity = new ActivityModel({
                author: author,
                userId: userId, 
                title: title,
                content: content,
                category: category || "Genel",
                location: {
                    type: 'Point',
                    coordinates: [parseFloat(longitude) || 0, parseFloat(latitude) || 0],
                    addressText: addressText || "Bilinmiyor"
                },
                participants: [userId],
                pendingParticipants: [], // Onay sistemi için
                maxParticipants: maxParticipants || 10,
                startTime: startTime || new Date().toISOString(),
                endTime: endTime || null,
                isPrivate: isPrivate || false,
                password: password || null,
                isSponsored: isSponsored || false,
                requiresApproval: requiresApproval || false
            });
            await newMongoActivity.save();
            console.log(`🌍 MONGODB: Yeni Aktivite -> ${title} (Sahibi: ${userId})`);
        } catch (dbErr) {
            console.log("MongoDB Kayıt Hatası:", dbErr);
        }
    }

    // JSON Yedek Sistemi
    const newActivity = {
        id: 'act_' + Math.random().toString(36).substr(2, 9),
        author: author,
        userId: userId, 
        title: title, 
        content: content,
        category: category || "Genel",
        location: { latitude: latitude || 0, longitude: longitude || 0, addressText: addressText || "Bilinmiyor" },
        participants: [userId], 
        pendingParticipants: [],
        maxParticipants: maxParticipants || 10,
        startTime: startTime || new Date().toISOString(),
        endTime: endTime || null,
        isPrivate: isPrivate || false,
        password: password || null,
        isSponsored: isSponsored || false,
        requiresApproval: requiresApproval || false,
        createdAt: new Date().toISOString()
    };

    activities.push(newActivity);
    saveActivities();
    
    res.status(201).json({ message: "Aktivite paylaşıldı!", activity: newActivity });
});

// 2. YAKINDAKİ AKTİVİTELER (FEED)
app.get('/api/activities/nearby', async (req, res) => {
    const { lat, lng, radius = 50 } = req.query; 

    if (mongoose.connection.readyState === 1 && ActivityModel) {
        try {
            const dbActivities = await ActivityModel.aggregate([
                {
                    $geoNear: {
                        near: { type: "Point", coordinates: [parseFloat(lng), parseFloat(lat)] },
                        distanceField: "distanceInMeters",
                        maxDistance: parseInt(radius) * 1000, 
                        spherical: true
                    }
                },
                // Gizli aktiviteleri feed'de gösterme (İlerisi için)
                { $match: { isPrivate: { $ne: true } } } 
            ]);
            
            const formattedActivities = dbActivities.map(act => ({
                id: act._id,
                author: act.author,
                userId: act.userId, 
                title: act.title,
                content: act.content,
                category: act.category,
                latitude: act.location.coordinates[1], 
                longitude: act.location.coordinates[0], 
                addressText: act.location.addressText,
                distanceInKm: (act.distanceInMeters / 1000).toFixed(2),
                createdAt: act.createdAt,
                participants: act.participants, 
                maxParticipants: act.maxParticipants
            }));

            return res.status(200).json(formattedActivities);
        } catch (dbErr) {
            return res.status(500).json({ message: "DB Hatası" });
        }
    } else {
        // Fallback JSON (eski sistem)
        res.status(200).json(activities.filter(a => !a.isPrivate));
    }
});

// 3. KULLANICININ KATILDIĞI AKTİVİTELERİ GETİR
app.get('/api/activities/user-activities/:userId', async (req, res) => {
    const { userId } = req.params;

    if (mongoose.connection.readyState === 1 && ActivityModel) {
        try {
            const userActivities = await ActivityModel.find({ participants: userId });
            
            const formattedActivities = userActivities.map(act => ({
                id: act._id,
                author: act.author,
                userId: act.userId, 
                title: act.title,
                content: act.content,
                category: act.category,
                latitude: act.location.coordinates[1], 
                longitude: act.location.coordinates[0], 
                addressText: act.location.addressText,
                distanceInKm: 0, 
                createdAt: act.createdAt,
                participants: act.participants,
                maxParticipants: act.maxParticipants
            }));

            return res.status(200).json(formattedActivities);
        } catch (dbErr) {
            return res.status(500).json({ message: "Veritabanı okuma hatası!" });
        }
    } else {
        const filtered = activities.filter(act => act.participants && act.participants.includes(userId));
        return res.status(200).json(filtered);
    }
});

// 4. AKTİVİTEYE KATIL (JOIN)
app.post('/api/activities/join', async (req, res) => {
    const { activityId, userId, providedPassword } = req.body;

    if (!activityId || !userId) return res.status(400).json({ message: "Aktivite ID ve Kullanıcı ID gerekli!" });

    // Hem JSON'da hem MongoDB'de güncelle
    let isSuccess = false;
    let actData = null;

    if (mongoose.connection.readyState === 1 && ActivityModel) {
        try {
            const activity = await ActivityModel.findById(activityId);
            if (activity) {
                if (activity.isPrivate && activity.password !== providedPassword) return res.status(401).json({ message: "Yanlış şifre!" });
                if (activity.participants.length >= activity.maxParticipants) return res.status(400).json({ message: "Kontenjan dolu!" });
                if (activity.participants.includes(userId)) return res.status(400).json({ message: "Zaten katıldınız!" });
                
                if (activity.requiresApproval) {
                    if (!activity.pendingParticipants.includes(userId)) {
                        activity.pendingParticipants.push(userId);
                        await activity.save();
                    }
                    return res.status(200).json({ message: "Onay isteği kurucuya gönderildi!", status: "pending" });
                }

                activity.participants.push(userId);
                await activity.save();
                isSuccess = true;
                actData = activity;
            }
        } catch (err) { console.log(err); }
    }

    const actIndex = activities.findIndex(a => a.id === activityId || a._id === activityId);
    if (actIndex !== -1) {
        const act = activities[actIndex];
        if (act.isPrivate && act.password !== providedPassword) return res.status(401).json({ message: "Yanlış şifre!" });
        if (act.participants.length >= act.maxParticipants) return res.status(400).json({ message: "Kontenjan dolu!" });
        if (act.participants.includes(userId)) return res.status(400).json({ message: "Zaten katıldınız!" });
        
        if (act.requiresApproval) {
            if (!act.pendingParticipants) act.pendingParticipants = [];
            if (!act.pendingParticipants.includes(userId)) act.pendingParticipants.push(userId);
            saveActivities();
            return res.status(200).json({ message: "Onay isteği gönderildi!", status: "pending" });
        }

        act.participants.push(userId);
        saveActivities();
        isSuccess = true;
        actData = actData || act;
    }

    if (isSuccess) return res.status(200).json({ message: "Aktiviteye başarıyla katıldınız!", activity: actData });
    return res.status(404).json({ message: "Aktivite bulunamadı!" });
});

// 5. AKTİVİTEDEN AYRIL (LEAVE)
app.post('/api/activities/leave', async (req, res) => {
    const { activityId, userId } = req.body;

    if (!activityId || !userId) return res.status(400).json({ message: "Aktivite ID ve Kullanıcı ID gerekli!" });

    let isSuccess = false;
    let actData = null;

    if (mongoose.connection.readyState === 1 && ActivityModel) {
        try {
            const activity = await ActivityModel.findById(activityId);
            if (activity) {
                if (activity.userId === userId) return res.status(400).json({ message: "Kendi oluşturduğunuz aktiviteden ayrılamazsınız." });
                activity.participants = activity.participants.filter(id => id !== userId);
                await activity.save();
                isSuccess = true;
                actData = activity;
            }
        } catch (err) {}
    }

    const actIndex = activities.findIndex(a => a.id === activityId || a._id === activityId);
    if (actIndex !== -1) {
        const act = activities[actIndex];
        if (act.userId === userId) return res.status(400).json({ message: "Kendi aktivitenizden ayrılamazsınız." });
        act.participants = act.participants.filter(id => id !== userId);
        saveActivities();
        isSuccess = true;
        actData = actData || act;
    }

    if (isSuccess) return res.status(200).json({ message: "Aktiviteden ayrıldınız.", activity: actData });
    return res.status(404).json({ message: "Aktivite bulunamadı!" });
});

// 6. AKTİVİTE GÜNCELLEME 
app.put('/api/activities/update/:id', async (req, res) => {
    const { id } = req.params;
    const { title, content, category, maxParticipants, userId } = req.body; 

    let isSuccess = false;
    let actData = null;

    if (mongoose.connection.readyState === 1 && ActivityModel) {
        try {
            const activity = await ActivityModel.findById(id);
            if (activity) {
                if (activity.userId !== userId) return res.status(403).json({ message: "Bu aktiviteyi düzenleme yetkiniz yok!" });
                activity.title = title || activity.title;
                activity.content = content || activity.content;
                activity.category = category || activity.category;
                activity.maxParticipants = maxParticipants || activity.maxParticipants;
                await activity.save();
                isSuccess = true;
                actData = activity;
            }
        } catch (err) {}
    }

    const actIndex = activities.findIndex(a => a.id === id || a._id === id);
    if (actIndex !== -1) {
        const act = activities[actIndex];
        if (act.userId !== userId) return res.status(403).json({ message: "Bu aktiviteyi düzenleme yetkiniz yok!" });
        act.title = title || act.title;
        act.content = content || act.content;
        act.category = category || act.category;
        act.maxParticipants = maxParticipants || act.maxParticipants;
        saveActivities();
        isSuccess = true;
        actData = actData || act;
    }

    if (isSuccess) return res.status(200).json({ message: "Aktivite güncellendi!", activity: actData });
    return res.status(404).json({ message: "Aktivite bulunamadı!" });
});

// 7. AKTİVİTEDEN KULLANICI AT (KICK)
app.post('/api/activities/kick', async (req, res) => {
    const { activityId, requesterId, targetId } = req.body;

    if (!activityId || !requesterId || !targetId) return res.status(400).json({ message: "Eksik bilgi!" });

    let isSuccess = false;

    if (mongoose.connection.readyState === 1 && ActivityModel) {
        try {
            const activity = await ActivityModel.findById(activityId);
            if (activity && activity.userId === requesterId && requesterId !== targetId) {
                activity.participants = activity.participants.filter(id => id !== targetId);
                await activity.save();
                isSuccess = true;
            }
        } catch (err) {}
    }

    const actIndex = activities.findIndex(a => a.id === activityId || a._id === activityId);
    if (actIndex !== -1) {
        const act = activities[actIndex];
        if (act.userId === requesterId && requesterId !== targetId) {
            act.participants = act.participants.filter(id => id !== targetId);
            saveActivities(); 
            isSuccess = true;
        }
    }

    if (isSuccess) return res.status(200).json({ message: "Kullanıcı başarıyla atıldı." });
    return res.status(400).json({ message: "İşlem başarısız veya yetkisiz." });
});

// ===================================================================================
// 👑 ADMİN PANELİ VE SİSTEM İSTATİSTİKLERİ
// ===================================================================================
app.get('/api/admin/stats', async (req, res) => {
    const { adminKey } = req.query; 
    if (adminKey !== "zona_super_admin_2026") return res.status(403).json({ message: "Erişim Reddedildi." });

    let totalUsers = users.length;
    let totalActivities = activities.length;

    if (mongoose.connection.readyState === 1 && ActivityModel) {
        try {
            totalActivities = await ActivityModel.countDocuments();
        } catch (err) {}
    }

    const stats = {
        totalUsers,
        totalActivities,
        activeSocketsNow: io.engine.clientsCount, 
        systemTime: new Date().toISOString()
    };
    res.status(200).json(stats);
});

// ===================================================================================
// AUTH, PROFİL, UPLOAD SİSTEMLERİ (EKSİKSİZ KORUNDU)
// ===================================================================================

app.post('/api/social-login', (req, res) => {
    const { email, username, provider } = req.body;
    if (!email) return res.status(400).json({ message: "Geçersiz sosyal medya verisi!" });

    const identifier = email.toLowerCase();
    let user = users.find(u => u.email && u.email.toLowerCase() === identifier);

    if (user) {
        console.log(`✅ Sosyal Login: ${user.username} (${provider})`);
        return res.status(200).json({ message: "Giriş başarılı!", user: user });
    } else {
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
            profilePic: "http://192.168.1.105:3000/uploads/default_pp.png",
            banner: "http://192.168.1.105:3000/uploads/default_banner.png",
            createdAt: new Date().toISOString()
        };

        users.push(newUser);
        saveUsers();
        console.log(`✨ Sosyal Kayıt: ${newUser.username} (${provider})`);
        return res.status(201).json({ message: "Sosyal hesap oluşturuldu!", user: newUser });
    }
});

app.post('/api/signup', (req, res) => {
    const { username, password, authType } = req.body;
    if (!username) return res.status(400).json({ message: "Kullanıcı adı gerekli!" });
    
    const identifier = username.toLowerCase();
    const isTaken = users.some(u => (u.email && u.email.toLowerCase() === identifier) || (u.username && u.username.toLowerCase() === identifier));
    
    if (isTaken) return res.status(400).json({ message: "Bu kullanıcı zaten mevcut!" });

    if (authType === "email") {
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        pendingUsers[identifier] = { username, password, authType: "local", isSocial: false, code: code, expires: Date.now() + 10 * 60 * 1000 };

        transporter.sendMail({
            from: '"ZONA Support" <zonaauth@gmail.com>',
            to: username,
            subject: `${code} - ZONA Doğrulama Kodun`,
            html: `<div style="text-align:center;"><h1>Onay Kodun: ${code}</h1></div>`
        });
        return res.status(201).json({ message: "Kod gönderildi!", requiresVerification: true });
    }

    const newUser = { 
        id: generateUniqueID(), username, email: "", password, authType: "local", 
        isSocial: false, isEmailVerified: false, bio: "Selam!", 
        location: "", district: "", zodiac: "", instagram: "", tiktok: "", 
        profilePic: "http://192.168.1.105:3000/uploads/default_pp.png",
        banner: "http://192.168.1.105:3000/uploads/default_banner.png",
        createdAt: new Date().toISOString()
    };
    users.push(newUser);
    saveUsers();
    res.status(201).json({ message: "Kayıt başarılı!", user: newUser, requiresVerification: false });
});

app.post('/api/user/verify-email', (req, res) => {
    const { identifier, code } = req.body;
    if (!identifier) return res.status(400).json({ message: "Geçersiz istek!" });
    
    const emailKey = identifier.toLowerCase();
    const pending = pendingUsers[emailKey];

    if (pending && pending.code === code) {
        const newUser = { 
            id: generateUniqueID(), username: pending.username, email: pending.username, password: pending.password, 
            authType: "local", isSocial: false, isEmailVerified: true, bio: "Selam!", 
            location: "", district: "", zodiac: "", instagram: "", tiktok: "", 
            profilePic: "http://192.168.1.105:3000/uploads/default_pp.png",
            banner: "http://192.168.1.105:3000/uploads/default_banner.png",
            createdAt: new Date().toISOString()
        };
        users.push(newUser);
        saveUsers();
        delete pendingUsers[emailKey];
        return res.status(200).json({ message: "E-posta doğrulandı!", user: newUser });
    } else {
        return res.status(400).json({ message: "Girdiğin kod hatalı veya süresi dolmuş!" });
    }
});

app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ message: "Dosya yüklenemedi!" });
    const fileUrl = `http://192.168.1.105:3000/uploads/${req.file.filename}`;
    res.status(200).json({ url: fileUrl });
});

app.post('/api/login', (req, res) => {
    const { identifier, password } = req.body;
    if (!identifier || !password) return res.status(400).json({ message: "Eksik bilgi!" });

    const user = users.find(u => ((u.username && u.username === identifier) || (u.email && u.email === identifier)) && u.password === password);
    if (!user) return res.status(401).json({ message: "Hatalı kullanıcı adı veya şifre!" });
    
    console.log(`🔑 Yerel Giriş: ${user.username}`);
    res.status(200).json({ user: user });
});

app.get('/api/user/:username', (req, res) => {
    const user = users.find(u => u.username === req.params.username || (u.email && u.email === req.params.username));
    if (!user) return res.status(404).json({ message: "Kullanıcı bulunamadı" });
    res.json(user);
});

app.post('/api/user/send-update-code', (req, res) => {
    const { username, email } = req.body;
    const identifier = email.toLowerCase();

    if (users.some(u => u.email && u.email.toLowerCase() === identifier && u.username !== username)) {
        return res.status(400).json({ message: "Bu e-posta adresi zaten kullanımda!" });
    }

    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    pendingUsers[identifier] = { username: username, code: code, newEmail: identifier };

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
    const pending = pendingUsers[identifier];

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

app.post('/api/user/update', (req, res) => {
    const { currentIdentifier, newUsername, bio, profilePic, banner, email, location, district, zodiac, instagram, tiktok } = req.body;
    
    if (email) {
        if (users.some(u => u.email && u.email.toLowerCase() === email.toLowerCase() && u.username !== currentIdentifier)) {
            return res.status(400).json({ message: "Bu e-posta adresi zaten kullanımda!" });
        }
    }

    const userIndex = users.findIndex(u => (u.username === currentIdentifier || (u.email && u.email === currentIdentifier)));
    if (userIndex === -1) return res.status(404).json({ message: "Kullanıcı bulunamadı!" });

    if (newUsername) users[userIndex].username = newUsername;
    if (bio !== undefined) users[userIndex].bio = bio;
    if (profilePic !== undefined) users[userIndex].profilePic = profilePic;
    if (banner !== undefined) users[userIndex].banner = banner;
    if (email) users[userIndex].email = email.toLowerCase();
    
    if (location !== undefined) users[userIndex].location = location;
    if (district !== undefined) users[userIndex].district = district;
    if (zodiac !== undefined) users[userIndex].zodiac = zodiac;
    if (instagram !== undefined) users[userIndex].instagram = instagram;
    if (tiktok !== undefined) users[userIndex].tiktok = tiktok;

    saveUsers();
    res.status(200).json({ message: "Profil güncellendi!", user: users[userIndex] });
});

// 🔥 SUNUCUYU APP.LISTEN YERİNE SERVER.LISTEN İLE BAŞLATIYORUZ (Socket.io için zorunlu)
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 ZONA Enterprise Sunucusu (Socket.io + Cron ile) ${PORT} portunda hazır!`);
});