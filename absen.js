// Halaman absen karyawan
(() => {
  const $ = id => document.getElementById(id);
  const S = { info: null, offset: 0, karyawan: [], pos: null, rec: null, busy: false, resultTimer: null,
             stream: null, facing: 'environment', foto: null };
  const LOGO_WM = new Image();
  LOGO_WM.src = 'assets/logo-mark-white.png';
  const FOTO_MAKS_UMUR = 3 * 60 * 1000; // foto harus diambil maks 3 menit sebelum absen

  /* ---------- Jam (disinkronkan dengan server) ---------- */
  function tick() {
    const d = new Date(Date.now() + S.offset);
    $('clock').textContent = U.time(d);
    $('date').textContent = U.longDate(d);
  }

  /* ---------- Data awal ---------- */
  async function loadInfo() {
    if (!API.configured()) {
      showNotice('API_URL belum diisi di config.js. Hubungi admin.');
      $('instansi').textContent = 'Belum dikonfigurasi';
      return;
    }
    try {
      const t0 = Date.now();
      const info = await API.call('info');
      const rtt = Date.now() - t0;
      S.offset = info.server_ms + rtt / 2 - Date.now();
      S.info = info;
      S.karyawan = info.karyawan || [];
      $('instansi').textContent = info.nama_instansi;
      document.title = 'Absensi — ' + info.nama_instansi;
      $('jamMasuk').textContent = info.jam_masuk;
      $('jamPulang').textContent = info.jam_pulang;
      $('toleransi').textContent = info.toleransi_menit + ' mnt';
      $('fotoReq').textContent = info.wajib_foto ? '(wajib)' : '(opsional)';
      renderOptions();
      const last = U.store.get('absen_last_id');
      if (last && S.karyawan.some(k => k.id === last)) {
        $('karyawan').value = last;
        onSelect();
      }
      updateLocText();
    } catch (e) {
      showNotice(e.message);
    }
  }

  function showNotice(msg) {
    const n = $('notice');
    n.textContent = msg;
    n.classList.remove('hidden');
  }

  function renderOptions() {
    const q = $('cari').value.trim().toLowerCase();
    const sel = $('karyawan');
    const cur = sel.value;
    const list = S.karyawan.filter(k => !q || k.nama.toLowerCase().includes(q) || k.id.toLowerCase().includes(q));
    sel.innerHTML = '<option value="">' + (list.length ? '— Pilih nama Anda —' : 'Tidak ada yang cocok') + '</option>' +
      list.map(k => `<option value="${U.esc(k.id)}">${U.esc(k.nama)} · ${U.esc(k.id)}${k.jabatan ? ' — ' + U.esc(k.jabatan) : ''}</option>`).join('');
    if (list.some(k => k.id === cur)) sel.value = cur;
    else if (q && list.length === 1) { sel.value = list[0].id; onSelect(); }
    else if (cur && !list.some(k => k.id === cur)) onSelect();
  }

  /* ---------- Status hari ini ---------- */
  async function onSelect() {
    const id = $('karyawan').value;
    S.rec = null;
    if (lapEd) lapEd.set([]);
    renderLaporan();
    setButtons();
    if (!id) { $('statusBox').classList.add('hidden'); return; }
    U.store.set('absen_last_id', id);
    if (S.foto && S.foto.id !== id) resetFoto(); // watermark berisi nama, wajib foto ulang
    $('statusBox').classList.remove('hidden');
    $('stMasuk').textContent = $('stPulang').textContent = $('stStatus').textContent = '…';
    try {
      const rec = await API.call('status', { id });
      if ($('karyawan').value !== id) return;
      S.rec = rec;
      renderStatus();
    } catch (e) {
      U.toast(e.message, 'err');
    }
  }

  let lapEd = null;
  function renderLaporan() {
    const r = S.rec;
    const tampil = !!(r && r.jamMasuk && !r.jamPulang);
    $('lapSection').classList.toggle('hidden', !tampil);
    if (!tampil) return;
    if (!lapEd) lapEd = Lap.editor($('lapEditor'));
    $('lapReq').textContent = S.info && S.info.wajib_laporan && !r.laporanCount ? '(wajib)' : '(opsional)';
    $('lapInfo').textContent = r.laporanCount
      ? `Sudah ada ${r.laporanCount} pekerjaan tercatat hari ini. Isian di bawah akan ditambahkan.`
      : 'Tulis pekerjaan yang Anda kerjakan hari ini. Tersimpan saat Anda absen pulang.';
  }

  function renderStatus() {
    const r = S.rec;
    $('stMasuk').textContent = r && r.jamMasuk ? U.hm(r.jamMasuk) : '—';
    $('stPulang').textContent = r && r.jamPulang ? U.hm(r.jamPulang) : '—';
    $('stStatus').textContent = r ? r.status : 'Belum';
    renderLaporan();
    setButtons(true);
  }

  function setButtons(loaded) {
    const id = $('karyawan').value;
    const r = S.rec;
    const lock = r && ['Izin', 'Sakit', 'Cuti', 'Alpa'].includes(r.status);
    $('btnMasuk').disabled = S.busy || !id || !loaded || lock || !!(r && r.jamMasuk);
    $('btnPulang').disabled = S.busy || !id || !loaded || lock || !(r && r.jamMasuk) || !!(r && r.jamPulang);
  }

  /* ---------- Lokasi ---------- */
  function startGeo() {
    if (!('geolocation' in navigator)) {
      setLoc('bad', 'Perangkat tidak mendukung lokasi');
      return;
    }
    navigator.geolocation.watchPosition(p => {
      S.pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) };
      updateLocText();
    }, err => {
      S.pos = null;
      setLoc('bad', err.code === 1 ? 'Izin lokasi ditolak — aktifkan di pengaturan browser' : 'Lokasi tidak tersedia');
    }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
  }

  function updateLocText() {
    if (!S.pos) return;
    const i = S.info;
    let txt = `Lokasi terdeteksi (±${S.pos.acc} m)`;
    let cls = 'ok';
    if (i && i.kantor_lat && i.kantor_lng) {
      const d = Math.round(U.dist(S.pos.lat, S.pos.lng, +i.kantor_lat, +i.kantor_lng));
      txt = `${d.toLocaleString('id-ID')} m dari kantor (±${S.pos.acc} m)`;
      if (i.radius_meter > 0 && d > i.radius_meter) { cls = 'bad'; txt += ` — di luar radius ${i.radius_meter} m`; }
      else if (i.radius_meter > 0 && i.akurasi_maks > 0 && S.pos.acc > i.akurasi_maks) { cls = 'bad'; txt += ' — sinyal GPS lemah'; }
    }
    setLoc(cls, txt);
  }

  function setLoc(cls, txt) {
    $('loc').className = 'loc ' + cls;
    $('locText').textContent = txt;
  }

  function freshPosition() {
    return new Promise(resolve => {
      if (!('geolocation' in navigator)) return resolve(S.pos);
      navigator.geolocation.getCurrentPosition(
        p => { S.pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }; updateLocText(); resolve(S.pos); },
        () => resolve(S.pos),
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 }
      );
    });
  }

  /* ---------- Kirim absen ---------- */
  async function submit(tipe) {
    const id = $('karyawan').value;
    const pin = $('pin').value.trim();
    if (!id) return U.toast('Pilih nama Anda terlebih dahulu', 'err');
    if (S.info && S.info.wajib_foto && !S.foto) return U.toast('Ambil foto lokasi terlebih dahulu', 'err');
    if (S.foto && Date.now() - S.foto.at > FOTO_MAKS_UMUR) { resetFoto(); return U.toast('Foto sudah lebih dari 3 menit. Silakan ambil ulang.', 'err'); }
    if (!/^\d{4,6}$/.test(pin)) { $('pin').focus(); return U.toast('Masukkan PIN 4–6 digit', 'err'); }

    const laporan = tipe === 'pulang' && lapEd ? lapEd.get() : [];
    if (tipe === 'pulang' && S.info && S.info.wajib_laporan && !laporan.length && !(S.rec && S.rec.laporanCount)) {
      $('lapEditor').querySelector('.lap-t').focus();
      return U.toast('Isi laporan kerja hari ini sebelum absen pulang', 'err');
    }
    if (tipe === 'pulang' && S.info) {
      const now = U.toMin(U.time(new Date(Date.now() + S.offset)));
      if (now < U.toMin(S.info.jam_pulang) && !confirm(`Belum jam pulang (${S.info.jam_pulang}). Tetap absen pulang sekarang?`)) return;
    }

    S.busy = true; setButtons(true);
    const btn = tipe === 'masuk' ? $('btnMasuk') : $('btnPulang');
    const label = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span> Memproses…';
    try {
      const pos = await freshPosition();
      if (S.info && S.info.radius_meter > 0 && !pos) throw new Error('Lokasi wajib aktif untuk absen. Izinkan akses lokasi.');
      const res = await API.post('absen', {
        id, pin, tipe,
        lat: pos ? pos.lat : '', lng: pos ? pos.lng : '', acc: pos ? pos.acc : '',
        foto: S.foto ? S.foto.data : '',
        laporan
      });
      if (lapEd) lapEd.set([]);
      $('pin').value = '';
      resetFoto();
      showResult(res);
      S.rec = await API.call('status', { id });
      renderStatus();
    } catch (e) {
      showError(e.message);
    } finally {
      S.busy = false;
      btn.textContent = label;
      setButtons(true);
    }
  }

  function showResult(r) {
    const late = r.tipe === 'masuk' && r.status === 'Terlambat';
    $('rIcon').className = 'result-icon ' + (late ? 'late' : 'ok');
    $('rIcon').textContent = late ? '!' : '✓';
    $('rTitle').textContent = r.tipe === 'masuk' ? `Selamat bekerja, ${r.nama.split(' ')[0]}` : `Terima kasih, ${r.nama.split(' ')[0]}`;
    $('rTime').textContent = U.hm(r.jam);
    let desc = r.tipe === 'masuk' ? 'Absen masuk tercatat' : 'Absen pulang tercatat';
    if (late) desc += ` · terlambat ${U.menit(r.telat)}`;
    if (r.tipe === 'pulang') desc += ` · durasi kerja ${U.menit(r.durasi)}${r.awal ? ' (pulang lebih awal)' : ''}`;
    if (r.tipe === 'pulang' && r.laporan) desc += ` · ${r.laporan} pekerjaan dilaporkan`;
    $('rDesc').textContent = desc;
    openResult();
  }

  function showError(msg) {
    $('rIcon').className = 'result-icon bad';
    $('rIcon').textContent = '✕';
    $('rTitle').textContent = 'Absen gagal';
    $('rTime').textContent = '';
    $('rDesc').textContent = msg;
    openResult();
  }

  function openResult() {
    $('result').classList.remove('hidden');
    $('rClose').focus();
    clearTimeout(S.resultTimer);
    S.resultTimer = setTimeout(closeResult, 7000);
  }
  function closeResult() { $('result').classList.add('hidden'); clearTimeout(S.resultTimer); }

  /* ---------- Kamera & foto lokasi ---------- */
  async function openCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return U.toast('Kamera tidak didukung browser ini. Gunakan Chrome/Safari terbaru (HTTPS).', 'err');
    }
    stopCamera();
    $('camHint').textContent = 'Membuka kamera…';
    try {
      S.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: S.facing }, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false
      });
    } catch (e) {
      $('camHint').textContent = e.name === 'NotAllowedError'
        ? 'Izin kamera ditolak. Aktifkan izin kamera di pengaturan browser, lalu coba lagi.'
        : 'Kamera tidak dapat dibuka.';
      return;
    }
    const v = $('video');
    v.srcObject = S.stream;
    v.classList.toggle('mirror', S.facing === 'user');
    try { await v.play(); } catch (e) {}
    show(v); hide($('snap')); hide($('camEmpty'));
    show($('btnFlip')); show($('btnShot')); hide($('btnRetake'));
    $('btnShot').disabled = false;
  }

  function stopCamera() {
    if (S.stream) S.stream.getTracks().forEach(t => t.stop());
    S.stream = null;
    $('video').srcObject = null;
  }

  function resetFoto() {
    stopCamera();
    S.foto = null;
    hide($('video')); hide($('snap')); show($('camEmpty'));
    hide($('btnFlip')); hide($('btnShot')); hide($('btnRetake'));
    $('camHint').textContent = 'Foto diambil langsung dari kamera, lengkap dengan waktu & koordinat.';
    const b = $('cam').querySelector('.cam-badge'); b && b.remove();
  }

  async function takePhoto() {
    const id = $('karyawan').value;
    if (!id) return U.toast('Pilih nama Anda terlebih dahulu', 'err');
    const v = $('video');
    if (!v.videoWidth) return U.toast('Kamera belum siap', 'err');
    $('btnShot').disabled = true;
    await freshPosition();

    const k = S.karyawan.find(x => x.id === id) || { nama: '', id };
    const scale = Math.min(1, 1024 / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.round(v.videoWidth * scale), h = Math.round(v.videoHeight * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.drawImage(v, 0, 0, w, h);

    // Watermark
    const now = new Date(Date.now() + S.offset);
    const f = Math.max(13, Math.round(Math.min(w, h) / 24));
    const lines = [];
    let lokasi = 'Lokasi tidak tersedia';
    if (S.pos) {
      lokasi = `${S.pos.lat.toFixed(6)}, ${S.pos.lng.toFixed(6)} (±${S.pos.acc} m)`;
      const i = S.info;
      if (i && i.kantor_lat && i.kantor_lng) {
        lokasi += ` · ${Math.round(U.dist(S.pos.lat, S.pos.lng, +i.kantor_lat, +i.kantor_lng)).toLocaleString('id-ID')} m dari kantor`;
      }
    }
    lines.push([`${k.nama} · ${k.id}`, 700, f]);
    lines.push([lokasi, 500, Math.round(f * .8)]);
    lines.push([(S.info && S.info.nama_instansi) || '', 500, Math.round(f * .8)]);
    const big = Math.round(f * 1.9);
    const pad = Math.round(f * .9);
    const blockH = pad * 2 + big + lines.reduce((a, l) => a + l[2] * 1.35, 0) + f * .4;
    const grad = g.createLinearGradient(0, h - blockH - f * 2, 0, h);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(.35, 'rgba(0,0,0,.55)');
    grad.addColorStop(1, 'rgba(0,0,0,.8)');
    g.fillStyle = grad;
    g.fillRect(0, h - blockH - f * 2, w, blockH + f * 2);

    const font = (wt, sz) => `${wt} ${sz}px "Plus Jakarta Sans", system-ui, sans-serif`;
    g.fillStyle = '#fff';
    g.textBaseline = 'alphabetic';
    let y = h - blockH + pad + big;
    g.font = font(800, big);
    const jam = U.time(now).slice(0, 5);
    g.fillText(jam, pad, y);
    const jw = g.measureText(jam).width;
    g.fillStyle = '#0e7a6d'; g.fillRect(pad + jw + f * .6, y - big * .78, Math.max(3, f * .18), big * .8);
    g.fillStyle = '#fff'; g.font = font(600, Math.round(f * .85));
    const logoW = LOGO_WM.naturalWidth ? Math.round(LOGO_WM.naturalWidth * big * 1.25 / LOGO_WM.naturalHeight) + f : 0;
    g.fillText(fit(g, new Intl.DateTimeFormat('id-ID', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }).format(now) + ' · WITA', w - pad * 2 - jw - f * 1.3 - logoW), pad + jw + f * 1.3, y - big * .12);
    if (LOGO_WM.complete && LOGO_WM.naturalWidth) {
      const lh = Math.round(big * 1.25), lw = Math.round(LOGO_WM.naturalWidth * lh / LOGO_WM.naturalHeight);
      g.globalAlpha = .92;
      g.drawImage(LOGO_WM, w - pad - lw, y - big * .95, lw, lh);
      g.globalAlpha = 1;
    }
    y += f * .4;
    lines.forEach(([t, wt, sz]) => {
      if (!t) return;
      y += sz * 1.35;
      g.font = font(wt, sz);
      g.fillText(fit(g, t, w - pad * 2), pad, y);
    });

    let data = c.toDataURL('image/jpeg', 0.72);
    if (data.length > 700000) data = c.toDataURL('image/jpeg', 0.55);

    S.foto = { data, at: Date.now(), id };
    stopCamera();
    $('snap').src = data;
    hide($('video')); show($('snap'));
    hide($('btnFlip')); hide($('btnShot')); show($('btnRetake'));
    const b = document.createElement('div');
    b.className = 'cam-badge'; b.textContent = '✓ Foto siap';
    $('cam').appendChild(b);
    $('pin').focus();
  }

  function fit(g, t, max) {
    if (g.measureText(t).width <= max) return t;
    while (t.length > 4 && g.measureText(t + '…').width > max) t = t.slice(0, -1);
    return t + '…';
  }
  const show = el => el.classList.remove('hidden');
  const hide = el => el.classList.add('hidden');

  $('btnCam').addEventListener('click', openCamera);
  $('btnShot').addEventListener('click', takePhoto);
  $('btnRetake').addEventListener('click', () => { resetFoto(); openCamera(); });
  $('btnFlip').addEventListener('click', () => { S.facing = S.facing === 'user' ? 'environment' : 'user'; openCamera(); });

  /* ---------- Event ---------- */
  $('cari').addEventListener('input', renderOptions);
  $('karyawan').addEventListener('change', onSelect);
  $('pin').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, ''); });
  $('pin').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (!$('btnMasuk').disabled) submit('masuk');
    else if (!$('btnPulang').disabled) submit('pulang');
  });
  $('btnMasuk').addEventListener('click', () => submit('masuk'));
  $('btnPulang').addEventListener('click', () => submit('pulang'));
  $('rClose').addEventListener('click', closeResult);
  $('result').addEventListener('click', e => { if (e.target.id === 'result') closeResult(); });

  // Muat ulang info saat tanggal berganti / tab aktif kembali
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && S.stream) { resetFoto(); return; }
    if (document.visibilityState === 'visible' && S.info && U.isoDate(new Date(Date.now() + S.offset)) !== S.info.tanggal) loadInfo();
    else if (document.visibilityState === 'visible' && $('karyawan').value) onSelect();
  });

  tick();
  setInterval(tick, 1000);
  startGeo();
  loadInfo();
})();
