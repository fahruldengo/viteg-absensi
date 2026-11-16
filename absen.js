// Halaman absen karyawan
(() => {
  const $ = id => document.getElementById(id);
  const S = { info: null, offset: 0, karyawan: [], pos: null, rec: null, busy: false, resultTimer: null };

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
    setButtons();
    if (!id) { $('statusBox').classList.add('hidden'); return; }
    U.store.set('absen_last_id', id);
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

  function renderStatus() {
    const r = S.rec;
    $('stMasuk').textContent = r && r.jamMasuk ? U.hm(r.jamMasuk) : '—';
    $('stPulang').textContent = r && r.jamPulang ? U.hm(r.jamPulang) : '—';
    $('stStatus').textContent = r ? r.status : 'Belum';
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
    if (!/^\d{4,6}$/.test(pin)) { $('pin').focus(); return U.toast('Masukkan PIN 4–6 digit', 'err'); }

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
      const res = await API.call('absen', { id, pin, tipe, lat: pos && pos.lat, lng: pos && pos.lng });
      $('pin').value = '';
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
    if (document.visibilityState === 'visible' && S.info && U.isoDate(new Date(Date.now() + S.offset)) !== S.info.tanggal) loadInfo();
    else if (document.visibilityState === 'visible' && $('karyawan').value) onSelect();
  });

  tick();
  setInterval(tick, 1000);
  startGeo();
  loadInfo();
})();
