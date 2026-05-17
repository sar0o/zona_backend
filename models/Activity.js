const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
  author: { type: String, required: true }, // Aktiviteyi oluşturan (Örn: Sarp)
  title: { type: String, required: true }, // Başlık (Örn: Akşam Koşusu)
  content: { type: String, required: true }, // Detay / Açıklama
  category: { type: String, required: true }, // Spor, Kahve, Oyun vb.
  userId: { type: String, required: true }, 
  
  // İŞTE BÜYÜ GÖSTERİSİ BURADA BAŞLIYOR (GeoJSON Formatı)
  location: {
    type: {
      type: String,
      enum: ['Point'], // Sadece nokta (pin) belirtir
      required: true
    },
    coordinates: {
      type: [Number], // Her zaman sırasıyla: [Boylam(Longitude), Enlem(Latitude)]
      required: true
    },
    addressText: { type: String } // Kullanıcının göreceği metin (Örn: Moda Sahili)
  },

  participants: [{ type: String }], // Katılanların listesi (Kullanıcı ID'leri veya isimleri)
  maxParticipants: { type: Number, default: 10 }, // Kontenjan
  createdAt: { type: Date, default: Date.now }
});

// KRİTİK KOD: Bu satır sayesinde MongoDB dünya haritasını anlar ve mesafe ölçebilir.
// 5.000 kişi bile olsa sorgu hızını milisaniyeye düşürür.
activitySchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Activity', activitySchema);