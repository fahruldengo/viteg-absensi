# Sistem Absensi Karyawan

Frontend statis (GitHub Pages) + Google Apps Script (API GET-only) + Google Sheets (database).

## Isi paket

| File | Fungsi |
|---|---|
| `index.html` + `absen.js` | Halaman utama: absen masuk/pulang karyawan |
| `admin.html` + `admin.js` | Panel admin: dashboard, data absensi, karyawan, pengaturan |
| `api.js` | Helper API & format (dipakai kedua halaman) |
| `style.css` | Tampilan |
| `config.js` | URL API & zona waktu — **jangan ditimpa saat update** |
| `Code.gs` | Backend Apps Script (tidak di-upload ke GitHub) |

## Pemasangan

1. **Spreadsheet** — buat Google Spreadsheet baru → Ekstensi → Apps Script.
2. Hapus isi `Code.gs` bawaan, tempel `Code.gs` dari paket ini, simpan.
3. Pilih fungsi `setup` → Jalankan → izinkan akses. Sheet `Karyawan`, `Absensi`, `Pengaturan` dibuat otomatis.
4. Terapkan → Deployment baru → Aplikasi web
   - Jalankan sebagai: **Saya**
   - Yang memiliki akses: **Siapa saja**
5. Salin URL `.../exec` ke `API_URL` di `config.js`.
6. Upload semua file kecuali `Code.gs` & `README.md` ke repo GitHub → aktifkan Pages.
7. Buka `admin.html`, masuk dengan password **admin123**, lalu **segera ganti** di Pengaturan.
8. Di Pengaturan: isi nama instansi, jam kerja, toleransi, dan lokasi kantor (tombol "Gunakan lokasi saya sekarang" saat berada di kantor) + radius.
9. Tambahkan karyawan dan bagikan PIN masing-masing.

> Setiap mengubah `Code.gs`: Terapkan → Kelola deployment → Edit → Versi: **Versi baru** → Terapkan (URL tetap sama).

## Aturan bisnis

- Waktu absen diambil dari **server** (WITA), bukan dari HP — jam HP yang diubah tidak berpengaruh.
- Masuk setelah `jam masuk + toleransi` → **Terlambat**, menit telat dihitung dari jam masuk.
- Satu catatan per karyawan per hari. Pulang hanya bisa setelah absen masuk.
- Radius > 0 → absen wajib dengan GPS dan di dalam radius kantor. Radius 0 → bebas, lokasi tetap dicatat bila diizinkan.
- PIN/password salah 5× → dikunci 10 menit.
- Karyawan yang tercatat Izin/Sakit/Cuti/Alpa tidak bisa absen pada hari itu.
- Sesi admin berlaku 6 jam sejak aktivitas terakhir.
- Menghapus karyawan tidak menghapus riwayat absensinya. Untuk karyawan keluar, cukup set **Nonaktif**.

## Catatan keamanan

PIN & password disimpan sebagai hash SHA-256. Karena API memakai GET, PIN terkirim di URL (lewat HTTPS) — cukup untuk absensi internal, tetapi jangan pakai PIN yang sama dengan PIN bank.
