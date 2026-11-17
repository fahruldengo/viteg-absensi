/**
 * SISTEM ABSENSI — Backend Google Apps Script
 * ------------------------------------------------------------
 * 1. Buat Google Spreadsheet baru → Ekstensi → Apps Script.
 * 2. Tempel seluruh file ini ke Code.gs, simpan.
 * 3. Pilih fungsi `setup` → Jalankan (sekali saja, izinkan akses).
 * 4. Terapkan → Deployment baru → Jenis: Aplikasi web
 *      Jalankan sebagai : Saya
 *      Yang memiliki akses: Siapa saja
 * 5. Salin URL /exec ke config.js (API_URL).
 *
 * Password admin awal: admin123  (segera ganti di menu Pengaturan)
 * Endpoint memakai GET; absen dengan foto memakai POST text/plain
 * (simple request, tetap tanpa CORS preflight).
 *
 * UPDATE dari versi tanpa foto: tempel ulang file ini, jalankan `setup`
 * sekali lagi (izinkan akses Google Drive & Maps), lalu deploy Versi baru.
 */

const TZ = 'Asia/Makassar'; // WITA. Samakan dengan TIMEZONE di config.js

const SH = { K: 'Karyawan', A: 'Absensi', P: 'Pengaturan', L: 'Laporan' };

const HEAD = {
  Karyawan:   ['ID', 'Nama', 'Jabatan', 'Divisi', 'PIN_Hash', 'Status', 'Dibuat'],
  Absensi:    ['ID', 'Tanggal', 'KaryawanID', 'Nama', 'JamMasuk', 'JamPulang', 'Status',
               'TelatMenit', 'LokasiMasuk', 'LokasiPulang', 'JarakMasuk', 'Keterangan', 'Diubah',
               'FotoMasuk', 'FotoPulang', 'AlamatMasuk', 'AlamatPulang'],
  Pengaturan: ['Key', 'Value'],
  Laporan:    ['ID', 'Tanggal', 'KaryawanID', 'Nama', 'Item', 'Catatan', 'Dibuat', 'Diubah']
};

const DEF = {
  nama_instansi: 'Nama Instansi',
  jam_masuk: '08:00',
  jam_pulang: '17:00',
  toleransi_menit: '15',
  kantor_lat: '',
  kantor_lng: '',
  radius_meter: '0',   // 0 = tanpa batas lokasi
  wajib_foto: 'ya',    // ya | tidak
  akurasi_maks: '100', // meter; 0 = tidak dicek
  wajib_laporan: 'tidak',   // ya = laporan kerja wajib saat absen pulang
  laporan_edit_hari: '3'    // karyawan bisa isi/ubah laporan hari ini + 2 hari sebelumnya
};

const LAPORAN_STATUS = ['Selesai', 'Proses', 'Kendala'];
const LAPORAN_MAX_ITEM = 30;

const FOTO_MAX_BYTES = 1500000; // batas ukuran foto (base64) per absen

const STATUS = ['Hadir', 'Terlambat', 'Dinas Luar', 'Izin', 'Sakit', 'Cuti', 'Alpa'];
const STATUS_HADIR = ['Hadir', 'Terlambat', 'Dinas Luar'];

/* ================= SETUP ================= */

function setup() {
  Object.keys(HEAD).forEach(n => rows_(n)); // buat sheet / upgrade header kolom baru
  const st = rows_(SH.P);
  Object.keys(DEF).forEach(k => {
    if (!st.find(r => r.Key === k)) setSetting_(k, DEF[k]);
  });
  if (!st.find(r => r.Key === 'admin_password_hash')) {
    setSetting_('admin_password_hash', hash_('admin123'));
  }
  folderFoto_(); // buat folder foto & minta izin Drive
  try { Maps.newGeocoder(); } catch (e) {} // minta izin Maps
  return 'Setup selesai';
}

/* ================= ROUTER ================= */

const PUBLIC = {
  info: info_,
  status: status_,
  absen: absen_,
  login: login_,
  loginPantau: loginPantau_,
  loginKaryawan: loginKaryawan_
};

// Endpoint karyawan (token login karyawan)
const EMP = {
  saya: saya_,
  fotoSaya: fotoSaya_,
  gantiPin: gantiPin_,
  laporanSaya: laporanSaya_,
  simpanLaporan: simpanLaporan_,
  logoutKaryawan: logoutKaryawan_
};

const ADMIN = {
  logout: logout_,
  dashboard: dashboard_,
  karyawan: listKaryawan_,
  saveKaryawan: saveKaryawan_,
  deleteKaryawan: deleteKaryawan_,
  absensi: listAbsensi_,
  saveAbsensi: saveAbsensi_,
  deleteAbsensi: deleteAbsensi_,
  foto: foto_,
  laporan: listLaporan_,
  settings: getSettings_,
  saveSettings: saveSettings_
};

function doGet(e) {
  const p = (e && e.parameter) || {};
  let out;
  try {
    out = { ok: true, data: route_(p) };
  } catch (err) {
    out = { ok: false, error: (err && err.message) || String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let out;
  try {
    const p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    out = { ok: true, data: route_(p) };
  } catch (err) {
    out = { ok: false, error: (err && err.message) || String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function route_(p) {
  const a = p.action;
  if (PUBLIC[a]) return PUBLIC[a](p);
  if (ADMIN[a]) { auth_(p.token, a); return ADMIN[a](p); }
  if (EMP[a]) return EMP[a](p, empAuth_(p.token));
  throw new Error('Aksi tidak dikenal: ' + a);
}

/* ================= PUBLIK ================= */

function info_() {
  const st = settings_();
  return {
    nama_instansi: st.nama_instansi,
    jam_masuk: st.jam_masuk,
    jam_pulang: st.jam_pulang,
    toleransi_menit: Number(st.toleransi_menit) || 0,
    radius_meter: Number(st.radius_meter) || 0,
    kantor_lat: st.kantor_lat,
    kantor_lng: st.kantor_lng,
    wajib_foto: st.wajib_foto === 'ya',
    akurasi_maks: Number(st.akurasi_maks) || 0,
    wajib_laporan: st.wajib_laporan === 'ya',
    server_ms: Date.now(),
    tanggal: today_(),
    karyawan: rows_(SH.K)
      .filter(k => k.Status === 'Aktif')
      .map(k => ({ id: k.ID, nama: k.Nama, jabatan: k.Jabatan }))
      .sort((a, b) => a.nama.localeCompare(b.nama))
  };
}

function status_(p) {
  const tgl = today_();
  const rec = rows_(SH.A).find(r => r.Tanggal === tgl && r.KaryawanID === p.id);
  if (!rec) return null;
  const out = pubAbs_(rec);
  const lap = getLaporan_(tgl, p.id);
  out.laporanCount = lap ? lap.items.length : 0; // isi laporan tidak dibuka di halaman publik
  return out;
}

function absen_(p) {
  return withLock_(() => {
    const k = rows_(SH.K).find(r => r.ID === p.id && r.Status === 'Aktif');
    if (!k) throw new Error('Karyawan tidak ditemukan atau nonaktif');
    checkPin_('k_' + k.ID, p.pin, k.PIN_Hash);

    if (p.tipe !== 'masuk' && p.tipe !== 'pulang') throw new Error('Tipe absen tidak valid');

    const st = settings_();
    const tgl = today_();
    const jam = nowTime_();
    const lat = parseFloat(p.lat), lng = parseFloat(p.lng), acc = parseFloat(p.acc);
    const hasLoc = isFinite(lat) && isFinite(lng);
    const rad = Number(st.radius_meter) || 0;
    const accMax = Number(st.akurasi_maks) || 0;
    let jarak = '';

    const foto = String(p.foto || '');
    if (foto) {
      if (foto.indexOf('data:image/jpeg;base64,') !== 0) throw new Error('Format foto tidak valid');
      if (foto.length > FOTO_MAX_BYTES) throw new Error('Ukuran foto terlalu besar');
    } else if (st.wajib_foto === 'ya') {
      throw new Error('Foto lokasi wajib diambil sebelum absen');
    }

    if (hasLoc && st.kantor_lat && st.kantor_lng) {
      jarak = Math.round(dist_(lat, lng, Number(st.kantor_lat), Number(st.kantor_lng)));
    }
    if (rad > 0 && st.kantor_lat && st.kantor_lng) {
      if (!hasLoc) throw new Error('Lokasi wajib diaktifkan untuk absen');
      if (accMax > 0 && isFinite(acc) && acc > accMax) {
        throw new Error('Akurasi GPS terlalu rendah (±' + Math.round(acc) + ' m, maks ' + accMax + ' m). Pindah ke area terbuka lalu coba lagi.');
      }
      if (jarak > rad) {
        throw new Error('Anda berada di luar area kantor (' + jarak + ' m, maksimal ' + rad + ' m)');
      }
    }
    const lok = hasLoc ? lat.toFixed(6) + ',' + lng.toFixed(6) : '';
    const rec = rows_(SH.A).find(r => r.Tanggal === tgl && r.KaryawanID === k.ID);

    if (p.tipe === 'masuk') {
      if (rec && rec.JamMasuk) throw new Error('Anda sudah absen masuk hari ini pukul ' + rec.JamMasuk.slice(0, 5));
      if (rec && !STATUS_HADIR.includes(rec.Status)) throw new Error('Hari ini Anda tercatat ' + rec.Status + '. Hubungi admin.');
      const fotoId = foto ? simpanFoto_(foto, tgl, k, 'masuk', jam) : '';
      const telat = Math.max(0, toMin_(jam) - toMin_(st.jam_masuk));
      const terlambat = telat > (Number(st.toleransi_menit) || 0);
      const obj = {
        ID: rec ? rec.ID : newId_(),
        Tanggal: tgl, KaryawanID: k.ID, Nama: k.Nama,
        JamMasuk: jam, JamPulang: '',
        Status: terlambat ? 'Terlambat' : 'Hadir',
        TelatMenit: String(terlambat ? telat : 0),
        LokasiMasuk: lok, LokasiPulang: '', JarakMasuk: String(jarak),
        Keterangan: rec ? rec.Keterangan : '',
        Diubah: stamp_(),
        FotoMasuk: fotoId, FotoPulang: '',
        AlamatMasuk: hasLoc ? alamat_(lat, lng) : '', AlamatPulang: ''
      };
      writeObj_(SH.A, obj, rec ? rec._row : null);
      return { tipe: 'masuk', nama: k.Nama, jam: jam, status: obj.Status, telat: Number(obj.TelatMenit) };
    }

    // pulang
    if (!rec || !rec.JamMasuk) throw new Error('Anda belum absen masuk hari ini');
    if (rec.JamPulang) throw new Error('Anda sudah absen pulang pukul ' + rec.JamPulang.slice(0, 5));
    const itemBaru = cleanItems_(p.laporan);
    const lapAda = getLaporan_(tgl, k.ID);
    if (st.wajib_laporan === 'ya' && !itemBaru.length && !(lapAda && lapAda.items.length)) {
      throw new Error('Isi laporan kerja hari ini sebelum absen pulang');
    }
    rec.JamPulang = jam;
    rec.LokasiPulang = lok;
    rec.FotoPulang = foto ? simpanFoto_(foto, tgl, k, 'pulang', jam) : '';
    rec.AlamatPulang = hasLoc ? alamat_(lat, lng) : '';
    rec.Diubah = stamp_();
    writeObj_(SH.A, rec, rec._row);
    if (itemBaru.length) {
      const gabung = (lapAda ? lapAda.items : []).concat(itemBaru).slice(0, LAPORAN_MAX_ITEM);
      saveLaporan_(tgl, k, gabung, lapAda ? lapAda.catatan : '', lapAda);
    }
    return {
      tipe: 'pulang', nama: k.Nama, jam: jam, status: rec.Status,
      awal: toMin_(jam) < toMin_(st.jam_pulang),
      durasi: toMin_(jam) - toMin_(rec.JamMasuk),
      laporan: itemBaru.length
    };
  });
}

function login_(p) {
  const st = settings_();
  checkPin_('admin', p.password, st.admin_password_hash);
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put('tok_' + token, '1', 21600); // 6 jam
  return { token: token, nama_instansi: st.nama_instansi };
}

// Panel Pantau: hanya lihat kehadiran & laporan kerja
const PANTAU_BOLEH = ['logout', 'dashboard', 'absensi', 'laporan', 'foto', 'karyawan'];

function loginPantau_(p) {
  const st = settings_();
  if (!st.pantau_password_hash) throw new Error('Panel Pantau belum diaktifkan oleh admin');
  checkPin_('pantau', p.password, st.pantau_password_hash);
  const token = Utilities.getUuid();
  // sesi terikat ke password saat ini: ganti/nonaktifkan password → sesi lama gugur
  CacheService.getScriptCache().put('tok_' + token, 'v:' + st.pantau_password_hash.slice(0, 12), 21600);
  return { token: token, nama_instansi: st.nama_instansi, peran: 'pantau' };
}

/* ================= KARYAWAN (PERFORMA SAYA) ================= */

function loginKaryawan_(p) {
  const id = String(p.id || '').trim().toUpperCase();
  const k = rows_(SH.K).find(r => r.ID.toUpperCase() === id && r.Status === 'Aktif');
  if (!k) throw new Error('ID karyawan tidak ditemukan atau nonaktif');
  checkPin_('k_' + k.ID, p.pin, k.PIN_Hash);
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put('emp_' + token, k.ID, 21600); // 6 jam
  return { token: token, karyawan: pubK_(k), nama_instansi: settings_().nama_instansi };
}

function empAuth_(token) {
  const c = CacheService.getScriptCache();
  const id = token && c.get('emp_' + token);
  if (!id) throw new Error('SESI_HABIS');
  c.put('emp_' + token, id, 21600);
  return id;
}

function logoutKaryawan_(p) {
  CacheService.getScriptCache().remove('emp_' + p.token);
  return true;
}

function saya_(p, kid) {
  const k = rows_(SH.K).find(r => r.ID === kid);
  if (!k || k.Status !== 'Aktif') throw new Error('SESI_HABIS');
  const st = settings_();
  const bulan = /^\d{4}-\d{2}$/.test(p.bulan || '') ? p.bulan : today_().slice(0, 7);
  const semua = rows_(SH.A).filter(a => a.KaryawanID === kid);

  // Tren 6 bulan terakhir (sampai bulan dipilih)
  const tren = [];
  let y = Number(bulan.slice(0, 4)), m = Number(bulan.slice(5, 7));
  for (let i = 0; i < 6; i++) {
    const key = y + '-' + ('0' + m).slice(-2);
    const r = ringkas_(semua.filter(a => a.Tanggal.slice(0, 7) === key), st);
    tren.unshift({ bulan: key, hadir: r.hadir, terlambat: r.terlambat, tidakHadir: r.izin + r.sakit + r.cuti + r.alpa });
    m--; if (m === 0) { m = 12; y--; }
  }

  const list = semua.filter(a => a.Tanggal.slice(0, 7) === bulan)
    .sort((a, b) => b.Tanggal.localeCompare(a.Tanggal));
  return {
    karyawan: pubK_(k),
    bulan: bulan,
    hari_ini: today_(),
    jam_masuk: st.jam_masuk,
    jam_pulang: st.jam_pulang,
    toleransi_menit: Number(st.toleransi_menit) || 0,
    ringkas: ringkas_(list, st),
    tren: tren,
    riwayat: list.map(pubAbs_),
    laporan: laporanBulan_(kid, bulan),
    laporan_edit_hari: Number(st.laporan_edit_hari) || 0,
    pertama: semua.reduce((min, a) => (!min || a.Tanggal < min) ? a.Tanggal : min, '')
  };
}

function ringkas_(list, st) {
  const r = { total: list.length, hadir: 0, tepat: 0, terlambat: 0, totalTelat: 0, dinas: 0,
              izin: 0, sakit: 0, cuti: 0, alpa: 0, pulangAwal: 0, lupaPulang: 0,
              rataMasuk: '', rataPulang: '', rataDurasi: 0 };
  let sm = 0, nm = 0, sp = 0, np = 0, sd = 0, nd = 0;
  const today = today_();
  list.forEach(a => {
    if (STATUS_HADIR.includes(a.Status)) {
      r.hadir++;
      if (a.Status === 'Terlambat') { r.terlambat++; r.totalTelat += Number(a.TelatMenit) || 0; }
      else if (a.Status === 'Dinas Luar') r.dinas++;
      else r.tepat++;
      if (a.JamMasuk) { sm += toMin_(a.JamMasuk); nm++; }
      if (a.JamPulang) {
        sp += toMin_(a.JamPulang); np++;
        if (toMin_(a.JamPulang) < toMin_(st.jam_pulang)) r.pulangAwal++;
        if (a.JamMasuk) { sd += toMin_(a.JamPulang) - toMin_(a.JamMasuk); nd++; }
      } else if (a.JamMasuk && a.Tanggal < today) r.lupaPulang++;
    }
    else if (a.Status === 'Izin') r.izin++;
    else if (a.Status === 'Sakit') r.sakit++;
    else if (a.Status === 'Cuti') r.cuti++;
    else if (a.Status === 'Alpa') r.alpa++;
  });
  const hm = n => ('0' + Math.floor(n / 60)).slice(-2) + ':' + ('0' + Math.round(n % 60)).slice(-2);
  if (nm) r.rataMasuk = hm(Math.round(sm / nm));
  if (np) r.rataPulang = hm(Math.round(sp / np));
  if (nd) r.rataDurasi = Math.round(sd / nd);
  const dasar = r.tepat + r.terlambat;
  r.persenTepat = dasar ? Math.round(r.tepat / dasar * 100) : null;
  return r;
}

function fotoSaya_(p, kid) {
  const id = String(p.id || '');
  const ada = id && rows_(SH.A).some(a => a.KaryawanID === kid && (a.FotoMasuk === id || a.FotoPulang === id));
  if (!ada) throw new Error('Foto tidak ditemukan');
  const f = DriveApp.getFileById(id);
  return { data: 'data:image/jpeg;base64,' + Utilities.base64Encode(f.getBlob().getBytes()) };
}

function gantiPin_(p, kid) {
  return withLock_(() => {
    const k = rows_(SH.K).find(r => r.ID === kid);
    if (!k) throw new Error('SESI_HABIS');
    checkPin_('k_' + k.ID, p.pinLama, k.PIN_Hash);
    if (!/^\d{4,6}$/.test(p.pinBaru || '')) throw new Error('PIN baru harus 4–6 digit angka');
    if (p.pinBaru === p.pinLama) throw new Error('PIN baru harus berbeda dari PIN lama');
    k.PIN_Hash = hash_(p.pinBaru);
    writeObj_(SH.K, k, k._row);
    return true;
  });
}

/* ================= LAPORAN KERJA ================= */

function cleanItems_(raw) {
  let arr = raw;
  if (typeof raw === 'string') { try { arr = JSON.parse(raw || '[]'); } catch (e) { throw new Error('Format laporan tidak valid'); } }
  if (!Array.isArray(arr)) return [];
  return arr.map(it => ({
    t: String((it && it.t) || '').replace(/\s+/g, ' ').trim().slice(0, 300),
    s: LAPORAN_STATUS.indexOf(it && it.s) >= 0 ? it.s : 'Selesai'
  })).filter(it => it.t).slice(0, LAPORAN_MAX_ITEM);
}

function parseLap_(r) {
  let items = [];
  try { items = JSON.parse(r.Item || '[]'); } catch (e) {}
  return { id: r.ID, tanggal: r.Tanggal, karyawanId: r.KaryawanID, nama: r.Nama,
           items: items, catatan: r.Catatan, dibuat: r.Dibuat, diubah: r.Diubah, _row: r._row };
}

function getLaporan_(tgl, kid) {
  const r = rows_(SH.L).find(x => x.Tanggal === tgl && x.KaryawanID === kid);
  return r ? parseLap_(r) : null;
}

function saveLaporan_(tgl, k, items, catatan, ada) {
  const obj = {
    ID: ada ? ada.id : 'L' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1296).toString(36).toUpperCase(),
    Tanggal: tgl, KaryawanID: k.ID, Nama: k.Nama,
    Item: JSON.stringify(items), Catatan: String(catatan || '').trim().slice(0, 1000),
    Dibuat: ada ? ada.dibuat : stamp_(), Diubah: stamp_()
  };
  writeObj_(SH.L, obj, ada ? ada._row : null);
  return pubLap_(parseLap_(obj));
}

function pubLap_(l) {
  return { id: l.id, tanggal: l.tanggal, karyawanId: l.karyawanId, nama: l.nama,
           items: l.items, catatan: l.catatan, diubah: l.diubah };
}

function batasLaporan_() {
  const n = Math.max(1, Number(settings_().laporan_edit_hari) || 1);
  const t = today_().split('-').map(Number);
  return new Date(Date.UTC(t[0], t[1] - 1, t[2] - (n - 1))).toISOString().slice(0, 10);
}

function laporanBulan_(kid, bulan) {
  const o = {};
  rows_(SH.L).filter(r => r.KaryawanID === kid && r.Tanggal.slice(0, 7) === bulan)
    .forEach(r => { o[r.Tanggal] = pubLap_(parseLap_(r)); });
  return o;
}

function laporanSaya_(p, kid) {
  const tgl = validDate_(p.tanggal) ? p.tanggal : today_();
  const lap = getLaporan_(tgl, kid);
  return { tanggal: tgl, laporan: lap ? pubLap_(lap) : null,
           bisaEdit: tgl <= today_() && tgl >= batasLaporan_(), batas: batasLaporan_() };
}

function simpanLaporan_(p, kid) {
  return withLock_(() => {
    const k = rows_(SH.K).find(r => r.ID === kid && r.Status === 'Aktif');
    if (!k) throw new Error('SESI_HABIS');
    const tgl = p.tanggal;
    if (!validDate_(tgl)) throw new Error('Tanggal tidak valid');
    if (tgl > today_()) throw new Error('Tidak bisa mengisi laporan untuk tanggal mendatang');
    if (tgl < batasLaporan_()) throw new Error('Laporan tanggal ini sudah dikunci (batas ' + (Number(settings_().laporan_edit_hari) || 1) + ' hari)');
    const items = cleanItems_(p.items);
    const catatan = String(p.catatan || '').trim();
    const ada = getLaporan_(tgl, kid);
    if (!items.length && !catatan) {
      if (ada) sheet_(SH.L).deleteRow(ada._row);
      return null;
    }
    return saveLaporan_(tgl, k, items, catatan, ada);
  });
}

function listLaporan_(p) {
  const dari = validDate_(p.dari) ? p.dari : '0000-00-00';
  const sampai = validDate_(p.sampai) ? p.sampai : '9999-99-99';
  let r = rows_(SH.L).filter(x => x.Tanggal >= dari && x.Tanggal <= sampai);
  if (p.karyawanId) r = r.filter(x => x.KaryawanID === p.karyawanId);
  r.sort((a, b) => b.Tanggal.localeCompare(a.Tanggal) || a.Nama.localeCompare(b.Nama));
  return r.map(x => pubLap_(parseLap_(x)));
}

/* ================= ADMIN ================= */

function logout_(p) {
  CacheService.getScriptCache().remove('tok_' + p.token);
  return true;
}

function dashboard_(p) {
  const tgl = validDate_(p.tanggal) ? p.tanggal : today_();
  const ks = rows_(SH.K).filter(k => k.Status === 'Aktif');
  const map = {};
  rows_(SH.A).filter(a => a.Tanggal === tgl).forEach(a => { map[a.KaryawanID] = a; });

  const c = { total: ks.length, hadir: 0, terlambat: 0, pulang: 0, tidak: 0, alpa: 0, belum: 0 };
  const list = ks.map(k => {
    const a = map[k.ID];
    const rec = a ? pubAbs_(a) : null;
    if (!rec) c.belum++;
    else if (STATUS_HADIR.includes(rec.status)) {
      c.hadir++;
      if (rec.status === 'Terlambat') c.terlambat++;
      if (rec.jamPulang) c.pulang++;
    } else if (rec.status === 'Alpa') c.alpa++;
    else c.tidak++;
    return { id: k.ID, nama: k.Nama, jabatan: k.Jabatan, divisi: k.Divisi, rec: rec };
  }).sort((a, b) => a.nama.localeCompare(b.nama));

  return { tanggal: tgl, hari_ini: today_(), ringkas: c, list: list };
}

function listKaryawan_() {
  return rows_(SH.K).map(pubK_).sort((a, b) => a.nama.localeCompare(b.nama));
}

function saveKaryawan_(p) {
  return withLock_(() => {
    const nama = String(p.nama || '').trim();
    if (!nama) throw new Error('Nama wajib diisi');
    if (p.pin && !/^\d{4,6}$/.test(p.pin)) throw new Error('PIN harus 4–6 digit angka');
    const status = p.status === 'Nonaktif' ? 'Nonaktif' : 'Aktif';
    const all = rows_(SH.K);

    if (p.mode === 'edit') {
      const k = all.find(x => x.ID === p.id);
      if (!k) throw new Error('Karyawan tidak ditemukan');
      Object.assign(k, { Nama: nama, Jabatan: p.jabatan || '', Divisi: p.divisi || '', Status: status });
      if (p.pin) k.PIN_Hash = hash_(p.pin);
      writeObj_(SH.K, k, k._row);
      return pubK_(k);
    }

    if (!p.pin) throw new Error('PIN wajib diisi untuk karyawan baru');
    let id = String(p.id || '').trim().toUpperCase();
    if (id) {
      if (!/^[A-Z0-9._-]{1,20}$/.test(id)) throw new Error('ID hanya boleh huruf, angka, titik, strip (maks 20)');
      if (all.find(x => x.ID.toUpperCase() === id)) throw new Error('ID ' + id + ' sudah dipakai');
    } else {
      let n = all.length + 1;
      do { id = 'K' + ('00' + n).slice(-3); n++; } while (all.find(x => x.ID === id));
    }
    const k = { ID: id, Nama: nama, Jabatan: p.jabatan || '', Divisi: p.divisi || '',
                PIN_Hash: hash_(p.pin), Status: status, Dibuat: stamp_() };
    writeObj_(SH.K, k, null);
    return pubK_(k);
  });
}

function deleteKaryawan_(p) {
  return withLock_(() => {
    const k = rows_(SH.K).find(x => x.ID === p.id);
    if (!k) throw new Error('Karyawan tidak ditemukan');
    sheet_(SH.K).deleteRow(k._row);
    return true; // riwayat absensi tetap disimpan (nama tersimpan di baris absensi)
  });
}

function listAbsensi_(p) {
  const dari = validDate_(p.dari) ? p.dari : '0000-00-00';
  const sampai = validDate_(p.sampai) ? p.sampai : '9999-99-99';
  let r = rows_(SH.A).filter(a => a.Tanggal >= dari && a.Tanggal <= sampai);
  if (p.karyawanId) r = r.filter(a => a.KaryawanID === p.karyawanId);
  if (p.status) r = r.filter(a => a.Status === p.status);
  r.sort((x, y) => (y.Tanggal + y.JamMasuk).localeCompare(x.Tanggal + x.JamMasuk));
  return r.map(pubAbs_);
}

function saveAbsensi_(p) {
  return withLock_(() => {
    if (!validDate_(p.tanggal)) throw new Error('Tanggal tidak valid');
    if (STATUS.indexOf(p.status) < 0) throw new Error('Status tidak valid');
    const k = rows_(SH.K).find(x => x.ID === p.karyawanId);
    if (!k) throw new Error('Karyawan tidak ditemukan');

    const all = rows_(SH.A);
    const rec = p.id ? all.find(a => a.ID === p.id) : null;
    if (p.id && !rec) throw new Error('Data absensi tidak ditemukan');
    const dup = all.find(a => a.Tanggal === p.tanggal && a.KaryawanID === k.ID && a.ID !== p.id);
    if (dup) throw new Error('Absensi ' + k.Nama + ' tanggal ' + p.tanggal + ' sudah ada. Edit data tersebut.');

    const st = settings_();
    const hadir = STATUS_HADIR.includes(p.status);
    const jm = hadir ? normTime_(p.jamMasuk) : '';
    const jp = hadir ? normTime_(p.jamPulang) : '';
    if (jm && jp && toMin_(jp) < toMin_(jm)) throw new Error('Jam pulang lebih awal dari jam masuk');
    const telat = (p.status === 'Terlambat' && jm) ? Math.max(0, toMin_(jm) - toMin_(st.jam_masuk)) : 0;

    const obj = Object.assign(rec || { ID: newId_(), LokasiMasuk: '', LokasiPulang: '', JarakMasuk: '' }, {
      Tanggal: p.tanggal, KaryawanID: k.ID, Nama: k.Nama,
      JamMasuk: jm, JamPulang: jp, Status: p.status, TelatMenit: String(telat),
      Keterangan: String(p.ket || '').slice(0, 300),
      Diubah: stamp_() + ' (admin)'
    });
    writeObj_(SH.A, obj, rec ? rec._row : null);
    return pubAbs_(obj);
  });
}

function deleteAbsensi_(p) {
  return withLock_(() => {
    const a = rows_(SH.A).find(x => x.ID === p.id);
    if (!a) throw new Error('Data absensi tidak ditemukan');
    sheet_(SH.A).deleteRow(a._row);
    [a.FotoMasuk, a.FotoPulang].forEach(id => {
      if (id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {} }
    });
    return true;
  });
}

function foto_(p) {
  const id = String(p.id || '');
  const ada = id && rows_(SH.A).some(a => a.FotoMasuk === id || a.FotoPulang === id);
  if (!ada) throw new Error('Foto tidak ditemukan');
  const f = DriveApp.getFileById(id);
  return {
    data: 'data:image/jpeg;base64,' + Utilities.base64Encode(f.getBlob().getBytes()),
    url: f.getUrl(),
    nama: f.getName()
  };
}

function getSettings_() {
  const st = settings_();
  delete st.admin_password_hash;
  delete st.folder_foto_id;
  st.pantau_aktif = !!st.pantau_password_hash;
  delete st.pantau_password_hash;
  st.timezone = TZ;
  return st;
}

function saveSettings_(p) {
  return withLock_(() => {
    const tm = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!tm.test(p.jam_masuk || '')) throw new Error('Jam masuk tidak valid (HH:MM)');
    if (!tm.test(p.jam_pulang || '')) throw new Error('Jam pulang tidak valid (HH:MM)');
    const tol = parseInt(p.toleransi_menit, 10), rad = parseInt(p.radius_meter, 10);
    if (!(tol >= 0 && tol <= 240)) throw new Error('Toleransi harus 0–240 menit');
    if (!(rad >= 0 && rad <= 100000)) throw new Error('Radius tidak valid');
    const lat = String(p.kantor_lat || '').trim(), lng = String(p.kantor_lng || '').trim();
    if ((lat || lng) && !(isFinite(parseFloat(lat)) && isFinite(parseFloat(lng)))) {
      throw new Error('Koordinat kantor tidak valid');
    }
    if (rad > 0 && !(lat && lng)) throw new Error('Isi koordinat kantor jika radius diaktifkan');
    const cur = settings_();
    const lapHari = parseInt(p.laporan_edit_hari === undefined || p.laporan_edit_hari === '' ? cur.laporan_edit_hari : p.laporan_edit_hari, 10);
    if (!(lapHari >= 1 && lapHari <= 31)) throw new Error('Batas isi laporan harus 1–31 hari');
    const accMax = parseInt(p.akurasi_maks === undefined || p.akurasi_maks === '' ? cur.akurasi_maks : p.akurasi_maks, 10);
    if (!(accMax >= 0 && accMax <= 5000)) throw new Error('Akurasi maksimal tidak valid');

    setSetting_('nama_instansi', String(p.nama_instansi || '').trim() || DEF.nama_instansi);
    setSetting_('jam_masuk', p.jam_masuk);
    setSetting_('jam_pulang', p.jam_pulang);
    setSetting_('toleransi_menit', tol);
    setSetting_('radius_meter', rad);
    setSetting_('kantor_lat', lat);
    setSetting_('kantor_lng', lng);
    setSetting_('wajib_foto', p.wajib_foto === 'tidak' || p.wajib_foto === 'ya' ? p.wajib_foto : cur.wajib_foto);
    setSetting_('akurasi_maks', accMax);
    setSetting_('wajib_laporan', p.wajib_laporan === 'ya' || p.wajib_laporan === 'tidak' ? p.wajib_laporan : cur.wajib_laporan);
    setSetting_('laporan_edit_hari', lapHari);

    if (p.password_baru) {
      if (String(p.password_baru).length < 6) throw new Error('Password baru minimal 6 karakter');
      if (cur.pantau_password_hash && hash_(p.password_baru) === cur.pantau_password_hash) throw new Error('Password admin harus berbeda dari password Panel Pantau');
      setSetting_('admin_password_hash', hash_(p.password_baru));
    }
    if (p.pantau_nonaktif === 'ya') {
      setSetting_('pantau_password_hash', '');
    } else if (p.pantau_password_baru) {
      if (String(p.pantau_password_baru).length < 6) throw new Error('Password Panel Pantau minimal 6 karakter');
      const ph = hash_(p.pantau_password_baru);
      const adminHash = p.password_baru ? hash_(p.password_baru) : cur.admin_password_hash;
      if (ph === adminHash) throw new Error('Password Panel Pantau harus berbeda dari password admin');
      setSetting_('pantau_password_hash', ph);
    }
    return getSettings_();
  });
}

/* ================= HELPER ================= */

function auth_(token, action) {
  const c = CacheService.getScriptCache();
  const v = token && c.get('tok_' + token);
  if (!v) throw new Error('SESI_HABIS');
  if (v !== '1') { // token Panel Pantau
    const h = settings_().pantau_password_hash || '';
    if (!h || v !== 'v:' + h.slice(0, 12)) { c.remove('tok_' + token); throw new Error('SESI_HABIS'); }
    if (PANTAU_BOLEH.indexOf(action) < 0) throw new Error('Akses ditolak: Panel Pantau hanya bisa melihat data');
  }
  c.put('tok_' + token, v, 21600); // perpanjang sesi
}

function checkPin_(key, input, savedHash) {
  const c = CacheService.getScriptCache();
  const k = 'fail_' + key;
  const n = Number(c.get(k) || 0);
  if (n >= 5) throw new Error('Terlalu banyak percobaan salah. Coba lagi dalam 10 menit.');
  if (!input || hash_(input) !== savedHash) {
    c.put(k, String(n + 1), 600);
    const sisa = 4 - n;
    throw new Error(sisa > 0 ? 'PIN/password salah (' + sisa + ' percobaan tersisa)' : 'Terlalu banyak percobaan salah. Coba lagi dalam 10 menit.');
  }
  c.remove(k);
}

function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let s = ss.getSheetByName(name);
  if (!s) {
    s = ss.insertSheet(name);
    s.getRange('A:Z').setNumberFormat('@'); // simpan semua sebagai teks
    s.getRange(1, 1, 1, HEAD[name].length).setValues([HEAD[name]]).setFontWeight('bold');
    s.setFrozenRows(1);
  }
  return s;
}

function rows_(name) {
  const s = sheet_(name);
  const v = s.getDataRange().getDisplayValues();
  let h = v.shift() || [];
  if (HEAD[name] && h.length < HEAD[name].length) { // upgrade kolom baru
    s.getRange(1, 1, 1, HEAD[name].length).setNumberFormat('@').setValues([HEAD[name]]).setFontWeight('bold');
    h = HEAD[name];
  }
  const out = [];
  v.forEach((r, i) => {
    if (r[0] === '') return;
    const o = { _row: i + 2 };
    h.forEach((key, j) => { o[key] = r[j]; });
    out.push(o);
  });
  return out;
}

function writeObj_(name, obj, row) {
  const s = sheet_(name);
  const arr = HEAD[name].map(k => (obj[k] === undefined || obj[k] === null) ? '' : String(obj[k]));
  const r = row || s.getLastRow() + 1;
  s.getRange(r, 1, 1, arr.length).setNumberFormat('@').setValues([arr]);
}

function settings_() {
  const o = {};
  rows_(SH.P).forEach(r => { o[r.Key] = r.Value; });
  Object.keys(DEF).forEach(k => { if (o[k] === undefined) o[k] = DEF[k]; });
  return o;
}

function setSetting_(key, val) {
  const r = rows_(SH.P).find(x => x.Key === key);
  const s = sheet_(SH.P);
  const row = r ? r._row : s.getLastRow() + 1;
  s.getRange(row, 1, 1, 2).setNumberFormat('@').setValues([[key, String(val)]]);
}

function pubK_(k) {
  return { id: k.ID, nama: k.Nama, jabatan: k.Jabatan, divisi: k.Divisi, status: k.Status, dibuat: k.Dibuat };
}

function pubAbs_(a) {
  return {
    id: a.ID, tanggal: a.Tanggal, karyawanId: a.KaryawanID, nama: a.Nama,
    jamMasuk: a.JamMasuk, jamPulang: a.JamPulang, status: a.Status,
    telat: Number(a.TelatMenit) || 0, lokasiMasuk: a.LokasiMasuk, lokasiPulang: a.LokasiPulang,
    jarak: a.JarakMasuk, ket: a.Keterangan, diubah: a.Diubah,
    fotoMasuk: a.FotoMasuk || '', fotoPulang: a.FotoPulang || '',
    alamatMasuk: a.AlamatMasuk || '', alamatPulang: a.AlamatPulang || ''
  };
}

function withLock_(fn) {
  const l = LockService.getScriptLock();
  l.waitLock(15000);
  try { return fn(); } finally { l.releaseLock(); }
}

function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('');
}

function today_()   { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function nowTime_() { return Utilities.formatDate(new Date(), TZ, 'HH:mm:ss'); }
function stamp_()   { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }
function newId_()   { return 'A' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1296).toString(36).toUpperCase(); }
function validDate_(d) { return /^\d{4}-\d{2}-\d{2}$/.test(d || ''); }

function toMin_(t) {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

function normTime_(t) {
  t = String(t || '').trim();
  if (!t) return '';
  const m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error('Format jam tidak valid: ' + t);
  return ('0' + m[1]).slice(-2) + ':' + m[2] + ':' + (m[3] || '00');
}

function dist_(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* ================= FOTO & ALAMAT ================= */

function folderFoto_() {
  const id = settings_().folder_foto_id;
  if (id) { try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) {} }
  const f = DriveApp.createFolder('Foto Absensi');
  setSetting_('folder_foto_id', f.getId());
  return f;
}

function subFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function simpanFoto_(dataUrl, tgl, k, tipe, jam) {
  const bytes = Utilities.base64Decode(dataUrl.split(',')[1]);
  const nama = tgl + '_' + k.ID + '_' + tipe + '_' + jam.replace(/:/g, '') + '.jpg';
  const blob = Utilities.newBlob(bytes, 'image/jpeg', nama);
  const folder = subFolder_(folderFoto_(), tgl.slice(0, 7)); // per bulan: 2026-11
  const file = folder.createFile(blob);
  file.setDescription(k.Nama + ' — absen ' + tipe + ' ' + tgl + ' ' + jam);
  return file.getId();
}

function alamat_(lat, lng) {
  try {
    const r = Maps.newGeocoder().setLanguage('id').reverseGeocode(lat, lng);
    return (r && r.results && r.results[0] && r.results[0].formatted_address) || '';
  } catch (e) {
    return '';
  }
}
