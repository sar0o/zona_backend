const express = require('express');
const cors = require('cors');
const fs = require('fs');
const nodemailer = require('nodemailer');

const app = express();
const PORT = 3000;
const USERS_FILE = './users.json';

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// --- VERİ TABANI YÜKLEME ---
let users = [];
if (fs.existsSync(USERS_FILE)) {
    try { 
        users = JSON.parse(fs.readFileSync(USERS_FILE)); 
    } catch (err) { 
        console.log("⚠️ Veritabanı okuma hatası, temiz liste oluşturuldu.");
        users = []; 
    }
}
const saveUsers = () => fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

// --- GEÇİCİ HAFIZA (KOD ONAYLANANA KADAR BURADA BEKLERLER) ---
const pendingUsers = {}; 

// --- MAİL GÖNDERİCİ AYARLARI ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'zonaauth@gmail.com', 
        pass: 'jhbf ekeo dggr jgnq'   
    }
});

// Senin istediğin o efsanevi onay mesajı
transporter.verify(function (error, success) {
  if (error) console.log("❌ Mail hatası:", error);
  else console.log("✅ Mail sunucusu fişek gibi, gönderime hazır!");
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

// --- SOSYAL MEDYA GİRİŞ / KAYIT MOTORU ---
app.post('/api/social-login', (req, res) => {
    const { email, username, provider } = req.body;
    
    if (!email) return res.status(400).json({ message: "Geçersiz sosyal medya verisi!" });

    const identifier = email.toLowerCase();
    let user = users.find(u => u.email && u.email.toLowerCase() === identifier);

    if (user) {
        if (provider === "google") {
            console.log(`🚀 Google ile giriş yapıldı: ${user.username} (${identifier})`);
        } else {
            console.log(`✅ Sosyal Login: ${user.username} (${provider})`);
        }
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
            location: "", // YENİ: Boş şehir bilgisi
            profilePic: "http://127.0.0.1:3000/uploads/default_pp.png",
            banner: "http://127.0.0.1:3000/uploads/default_banner.png",
            createdAt: new Date().toISOString()
        };

        users.push(newUser);
        saveUsers();
        
        if (provider === "google") {
            console.log(`✨ Google ile yeni kayıt: ${newUser.username}`);
        } else {
            console.log(`✨ Sosyal Kayıt: ${newUser.username} (${provider})`);
        }
        
        return res.status(201).json({ message: "Sosyal hesap oluşturuldu!", user: newUser });
    }
});

// --- KAYIT BAŞLATMA (SIGNUP) ---
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
            username,
            password,
            authType: "local",
            isSocial: false,
            code: code,
            expires: Date.now() + 10 * 60 * 1000 
        };

        const mailOptions = {
            from: '"ZONA Support" <zonaauth@gmail.com>',
            to: username,
            subject: `${code} - ZONA Doğrulama Kodun`,
            html: `<div style="text-align:center;"><h1>Onay Kodun: ${code}</h1></div>`
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.log("❌ Mail Gönderim Hatası:", error.message);
            } else {
                console.log(`✅ Kod başarıyla gönderildi: ${username}`);
            }
        });

        return res.status(201).json({ message: "Kod gönderildi!", requiresVerification: true });
    }

    const newUser = { 
        id: generateUniqueID(), username, 
        email: "", password, authType: "local", 
        isSocial: false, 
        isEmailVerified: false, bio: "Selam!",
        location: "", // YENİ: Boş şehir bilgisi
        profilePic: "http://127.0.0.1:3000/uploads/default_pp.png",
        banner: "http://127.0.0.1:3000/uploads/default_banner.png",
        createdAt: new Date().toISOString()
    };
    users.push(newUser);
    saveUsers();
    res.status(201).json({ message: "Kayıt başarılı!", user: newUser, requiresVerification: false });
});

// --- KOD DOĞRULAMA ---
app.post('/api/user/verify-email', (req, res) => {
    const { identifier, code } = req.body;
    if (!identifier) return res.status(400).json({ message: "Geçersiz istek!" });
    
    const emailKey = identifier.toLowerCase();
    const pending = pendingUsers[emailKey];

    if (pending && pending.code === code) {
        const newUser = { 
            id: generateUniqueID(),
            username: pending.username, 
            email: pending.username, 
            password: pending.password, 
            authType: "local",
            isSocial: false,
            isEmailVerified: true, 
            bio: "Selam!",
            location: "", // YENİ: Boş şehir bilgisi
            profilePic: "http://127.0.0.1:3000/uploads/default_pp.png",
            banner: "http://127.0.0.1:3000/uploads/default_banner.png",
            createdAt: new Date().toISOString()
        };

        users.push(newUser);
        saveUsers();
        delete pendingUsers[emailKey];

        console.log(`✨ HESAP OLUŞTURULDU: ${emailKey}`);
        return res.status(200).json({ message: "E-posta doğrulandı!", user: newUser });
    } else {
        return res.status(400).json({ message: "Girdiğin kod hatalı veya süresi dolmuş!" });
    }
});

// --- GİRİŞ YAP (LOGIN) ---
app.post('/api/login', (req, res) => {
    const { identifier, password } = req.body;
    if (!identifier || !password) return res.status(400).json({ message: "Eksik bilgi!" });

    const user = users.find(u => 
        ((u.username && u.username === identifier) || (u.email && u.email === identifier)) && u.password === password
    );

    if (!user) return res.status(401).json({ message: "Hatalı kullanıcı adı veya şifre!" });
    console.log(`🔑 Yerel Giriş: ${user.username}`);
    res.status(200).json({ user: user });
});

// --- TEKİL KULLANICI GETİR ---
app.get('/api/user/:username', (req, res) => {
    const user = users.find(u => u.username === req.params.username || (u.email && u.email === req.params.username));
    if (!user) return res.status(404).json({ message: "Kullanıcı bulunamadı" });
    res.json(user);
});

// --- PROFİLDEN E-POSTA EKLERKEN KOD GÖNDER ---
app.post('/api/user/send-update-code', (req, res) => {
    const { username, email } = req.body;
    const identifier = email.toLowerCase();

    const emailExists = users.some(u => u.email && u.email.toLowerCase() === identifier && u.username !== username);
    if (emailExists) {
        return res.status(400).json({ message: "Bu e-posta adresi zaten kullanımda!" });
    }

    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    pendingUsers[identifier] = {
        username: username,
        code: code,
        newEmail: identifier
    };

    const mailOptions = {
        from: '"ZONA Support" <zonaauth@gmail.com>',
        to: email,
        subject: `${code} - ZONA E-posta Onay Kodun`,
        html: `<div style="text-align:center;"><h1>Onay Kodun: ${code}</h1><p>Profilini güncellemek için bu kodu kullan.</p></div>`
    };

    transporter.sendMail(mailOptions);
    res.status(200).json({ message: "Kod gönderildi!" });
});

// --- PROFİLDEN GELEN KODU DOĞRULA ---
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

// --- PROFİL GÜNCELLEME (TEK VE KUSURSUZ YOL ✅) ---
app.post('/api/user/update', (req, res) => {
    // YENİ: req.body'den location'ı (şehri) de yakalıyoruz
    const { currentIdentifier, newUsername, bio, profilePic, banner, email, location } = req.body;
    
    // Güvenlik: E-posta başka birinde var mı?
    if (email) {
        const emailExists = users.some(u => u.email && u.email.toLowerCase() === email.toLowerCase() && u.username !== currentIdentifier);
        if (emailExists) return res.status(400).json({ message: "Bu e-posta adresi zaten kullanımda!" });
    }

    const userIndex = users.findIndex(u => (u.username === currentIdentifier || (u.email && u.email === currentIdentifier)));
    if (userIndex === -1) return res.status(404).json({ message: "Kullanıcı bulunamadı!" });

    // Verileri güncelle
    if (newUsername) users[userIndex].username = newUsername;
    if (bio !== undefined) users[userIndex].bio = bio;
    if (profilePic !== undefined) users[userIndex].profilePic = profilePic;
    if (banner !== undefined) users[userIndex].banner = banner;
    if (email) users[userIndex].email = email.toLowerCase();
    
    // YENİ: Gelen location (şehir) bilgisini json'a kaydet
    if (location !== undefined) users[userIndex].location = location;

    saveUsers();
    res.status(200).json({ message: "Profil güncellendi!", user: users[userIndex] });
});

app.listen(3000, '0.0.0.0', () => console.log(`🚀 ZONA Sunucusu 3000 portunda hazır!`));