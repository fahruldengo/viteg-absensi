// Halaman Performa Saya (login karyawan)
(() => {
  const $ = id => document.getElementById(id);
  const BLN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const S = { token: U.store.get('emp_token'), bulan: U.isoDate(new Date()).slice(0, 7), data: null, foto: new Map() };

  const show = el => el.classList.remove('hidden');
  const hide = el => el.classList.add('hidden');
  const blnLabel = b => BLN[+b.slice(5, 7) - 1] + ' ' + b.slice(0, 4);
  const blnShort = b => BLN[+b.slice(5, 7) - 1].slice(0, 3);
  const geser = (b, n) => {
    let y = +b.slice(0, 4), m = +b.slice(5, 7) + n;
    while (m < 1) { m += 12; y--; }
    while (m > 12) { m -= 12; y++; }
    return y + '-' + String(m).padStart(2, '0');
  };

  async function emp(action, params = {}, post) {
    try {
      const body = { ...params, token: S.token };
      return post ? await API.post(action, body) : await API.call(action, body);
    } catch (e) {
      if (e.message === 'SESI_HABIS') {
        logoutLocal();
        U.toast('Sesi berakhir, silakan masuk lagi', 'err');
        throw new Error('Sesi berakhir');
      }
      throw e;
    }
  }

  /* ---------- Login ---------- */
  function showLogin() {
    hide($('app')); show($('login'));
    if (!API.configured()) {
      $('loginNotice').textContent = 'API_URL belum diisi di config.js.';
      show($('loginNotice'));
    }
    const last = U.store.get('absen_last_id');
    if (last && !$('lId').value) $('lId').value = last;
    setTimeout(() => ($('lId').value ? $('lPin') : $('lId')).focus(), 50);
  }

  function logoutLocal() {
    S.token = null; S.data = null; S.foto.clear();
    U.store.del('emp_token');
    showLogin();
  }

  $('lPin').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, ''); });
  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('btnLogin');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Memeriksa…';
    try {
      const r = await API.post('loginKaryawan', { id: $('lId').value.trim(), pin: $('lPin').value });
      S.token = r.token;
      U.store.set('emp_token', r.token);
      U.store.set('absen_last_id', r.karyawan.id);
      $('lPin').value = '';
      hide($('login')); show($('app'));
      load();
    } catch (err) {
      U.toast(err.message, 'err');
    } finally {
      btn.disabled = false; btn.textContent = 'Masuk';
    }
  });

  $('btnLogout').addEventListener('click', async () => {
    try { await API.call('logoutKaryawan', { token: S.token }); } catch (e) {}
    logoutLocal();
  });

  /* ---------- Data ---------- */
  $('prev').addEventListener('click', () => { S.bulan = geser(S.bulan, -1); load(); });
  $('next').addEventListener('click', () => { S.bulan = geser(S.bulan, 1); load(); });

  async function load() {
    $('bulanLabel').textContent = blnLabel(S.bulan);
    $('content').style.opacity = .45;
    try {
      const d = S.data = await emp('saya', { bulan: S.bulan });
      render(d);
    } catch (e) {
      if (S.token) U.toast(e.message, 'err');
    } finally {
      $('content').style.opacity = 1;
    }
  }

  function render(d) {
    const k = d.karyawan, r = d.ringkas;
    $('nama').textContent = k.nama;
    $('sub').textContent = [k.id, k.jabatan, k.divisi].filter(Boolean).join(' · ');
    $('avatar').textContent = k.nama.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
    $('next').disabled = d.bulan >= d.hari_ini.slice(0, 7);
    $('prev').disabled = !!d.pertama && d.bulan <= d.pertama.slice(0, 7);

    // Skor ketepatan
    const pct = r.persenTepat;
    const col = pct === null ? 'var(--line)' : pct >= 90 ? 'var(--accent)' : pct >= 75 ? 'var(--late)' : 'var(--bad)';
    $('ring').style.background = `conic-gradient(${col} ${(pct || 0) * 3.6}deg, #ebe9e1 0)`;
    $('ringVal').textContent = pct === null ? '–' : pct + '%';
    const dasar = r.tepat + r.terlambat;
    $('scoreTitle').textContent = pct === null ? 'Belum ada data kehadiran'
      : pct >= 95 ? 'Sangat disiplin' : pct >= 85 ? 'Disiplin' : pct >= 70 ? 'Perlu ditingkatkan' : 'Sering terlambat';
    $('scoreSub').textContent = dasar
      ? `${r.tepat} dari ${dasar} hari masuk tepat waktu · jam masuk ${d.jam_masuk} (toleransi ${d.toleransi_menit} mnt)`
      : `Jam masuk ${d.jam_masuk} · jam pulang ${d.jam_pulang}`;

    // Statistik
    const st = [
      ['Hadir', r.hadir, r.dinas ? `${r.dinas} dinas luar` : 'hari', 's-ok'],
      ['Terlambat', r.terlambat, r.totalTelat ? `total ${U.menit(r.totalTelat)}` : 'kali', 's-late'],
      ['Rata-rata masuk', r.rataMasuk || '—', r.rataPulang ? `pulang ${r.rataPulang}` : '', 's-none'],
      ['Rata-rata kerja', r.rataDurasi ? U.menit(r.rataDurasi) : '—', 'per hari', 's-none'],
      ['Izin / Sakit / Cuti', r.izin + r.sakit + r.cuti, `${r.izin} izin · ${r.sakit} sakit · ${r.cuti} cuti`, 's-info'],
      ['Alpa', r.alpa, 'hari', 's-bad']
    ];
    if (r.pulangAwal) st.push(['Pulang awal', r.pulangAwal, `sebelum ${d.jam_pulang}`, 's-late']);
    if (r.lupaPulang) st.push(['Lupa absen pulang', r.lupaPulang, 'hari', 's-bad']);
    $('stats').innerHTML = st.map(([l, v, s, c]) => `<div class="stat ${c}"><span>${l}</span><b>${U.esc(v)}</b><small>${U.esc(s)}</small></div>`).join('');

    renderKalender(d);
    renderTren(d);
    renderRiwayat(d);
  }

  function warna(rec) {
    if (!rec) return '';
    return { 'Hadir': 'c-ok', 'Terlambat': 'c-late', 'Dinas Luar': 'c-info', 'Izin': 'c-info', 'Cuti': 'c-info', 'Sakit': 'c-warn', 'Alpa': 'c-bad' }[rec.status] || '';
  }

  function renderKalender(d) {
    const map = {};
    d.riwayat.forEach(r => { map[r.tanggal] = r; });
    const y = +d.bulan.slice(0, 4), m = +d.bulan.slice(5, 7);
    const jml = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const awal = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Senin = 0
    let html = '<div class="cal-day empty"></div>'.repeat(awal);
    for (let i = 1; i <= jml; i++) {
      const tgl = `${d.bulan}-${String(i).padStart(2, '0')}`;
      const r = map[tgl];
      const cls = ['cal-day', warna(r), tgl === d.hari_ini ? 'today' : '', tgl > d.hari_ini ? 'future' : ''].join(' ');
      html += `<button class="${cls}" ${r ? `data-id="${U.esc(r.id)}"` : 'disabled'} title="${r ? U.esc(r.status) : ''}">
        <b>${i}</b>${r && r.jamMasuk ? `<small>${U.hm(r.jamMasuk)}</small>` : ''}</button>`;
    }
    $('cal').innerHTML = html;
    $('kalInfo').textContent = `${d.riwayat.length} catatan`;
  }

  function renderTren(d) {
    const max = Math.max(1, ...d.tren.map(t => t.hadir + t.tidakHadir));
    $('trend').innerHTML = d.tren.map(t => {
      const tepat = t.hadir - t.terlambat;
      const h = n => (n / max * 100).toFixed(1) + '%';
      return `<div class="tr-col ${t.bulan === d.bulan ? 'cur' : ''}" title="${blnLabel(t.bulan)}: ${t.hadir} hadir, ${t.terlambat} terlambat, ${t.tidakHadir} tidak hadir">
        <div class="tr-bar">
          <i class="lg-none" style="height:${h(t.tidakHadir)}"></i>
          <i class="lg-late" style="height:${h(t.terlambat)}"></i>
          <i class="lg-ok" style="height:${h(tepat)}"></i>
        </div>
        <b>${t.hadir}</b><span>${blnShort(t.bulan)}</span>
      </div>`;
    }).join('');
  }

  function renderRiwayat(d) {
    $('riwInfo').textContent = blnLabel(d.bulan);
    if (!d.riwayat.length) {
      $('riwayat').innerHTML = '<div class="card empty">Belum ada catatan absensi pada bulan ini.</div>';
      return;
    }
    $('riwayat').innerHTML = d.riwayat.map(r => {
      const nFoto = (r.fotoMasuk ? 1 : 0) + (r.fotoPulang ? 1 : 0);
      return `<button class="riw-item card" data-id="${U.esc(r.id)}">
        <div class="riw-date"><b>${+r.tanggal.slice(8)}</b><span>${U.fmtTgl(r.tanggal).split(',')[0]}</span></div>
        <div class="riw-main">
          <div>${U.badge(r.status)}${r.telat ? ` <span class="riw-late">+${U.menit(r.telat)}</span>` : ''}</div>
          <div class="riw-time">${r.jamMasuk ? `${U.hm(r.jamMasuk)} – ${U.hm(r.jamPulang)}` : (r.ket ? U.esc(r.ket) : '—')}</div>
        </div>
        <div class="riw-side">${r.jamMasuk ? U.durasi(r.jamMasuk, r.jamPulang) : ''}${nFoto ? `<small>${nFoto} foto</small>` : ''}</div>
      </button>`;
    }).join('');
  }

  /* ---------- Detail hari ---------- */
  function openDetail(id) {
    const r = S.data && S.data.riwayat.find(x => x.id === id);
    if (!r) return;
    const box = (label, jam, foto, alamat, lok) => `<div class="foto-box">
      <div class="ph${foto ? '' : ' none'}" ${foto ? `data-foto="${U.esc(foto)}"` : ''}>${foto ? '<span class="spinner"></span>' : 'Tidak ada foto'}</div>
      <div class="meta"><b>${label} · ${U.hm(jam)}</b>${alamat ? U.esc(alamat) : (lok ? U.esc(lok) : '<span class="muted">Lokasi tidak tercatat</span>')}</div>
    </div>`;
    openModal(`
      <h3>${U.fmtTgl(r.tanggal)}</h3>
      <p class="muted" style="margin:0;font-size:13px">${U.badge(r.status)}${r.telat ? ` · terlambat ${U.menit(r.telat)}` : ''}${r.jamMasuk && r.jamPulang ? ` · ${U.durasi(r.jamMasuk, r.jamPulang)}` : ''}</p>
      ${r.ket ? `<p style="margin:10px 0 0;font-size:14px">${U.esc(r.ket)}</p>` : ''}
      ${STATUS_HADIR.includes(r.status) ? `<div class="foto-grid">
        ${box('Masuk', r.jamMasuk, r.fotoMasuk, r.alamatMasuk, r.lokasiMasuk)}
        ${box('Pulang', r.jamPulang, r.fotoPulang, r.alamatPulang, r.lokasiPulang)}
      </div>` : ''}
      <div class="form-actions"><button type="button" class="btn btn-ghost" data-close>Tutup</button></div>`, true);
    $('modal').querySelectorAll('[data-foto]').forEach(async el => {
      const fid = el.dataset.foto;
      try {
        if (!S.foto.has(fid)) S.foto.set(fid, (await emp('fotoSaya', { id: fid })).data);
        el.innerHTML = `<img src="${S.foto.get(fid)}" alt="Foto absen">`;
      } catch (e) { el.textContent = e.message; }
    });
  }
  const STATUS_HADIR = ['Hadir', 'Terlambat', 'Dinas Luar'];

  $('cal').addEventListener('click', e => { const b = e.target.closest('[data-id]'); b && openDetail(b.dataset.id); });
  $('riwayat').addEventListener('click', e => { const b = e.target.closest('[data-id]'); b && openDetail(b.dataset.id); });

  /* ---------- Ganti PIN ---------- */
  $('btnPin').addEventListener('click', () => {
    openModal(`
      <h3>Ganti PIN</h3>
      <p class="muted" style="margin:0;font-size:13px">PIN ini dipakai untuk absen dan masuk ke halaman ini.</p>
      <form id="fPin">
        <label class="lbl">PIN lama</label><input name="lama" class="inp pin" type="password" inputmode="numeric" maxlength="6" required>
        <label class="lbl">PIN baru (4–6 digit)</label><input name="baru" class="inp pin" type="password" inputmode="numeric" maxlength="6" required>
        <label class="lbl">Ulangi PIN baru</label><input name="ulang" class="inp pin" type="password" inputmode="numeric" maxlength="6" required>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-close>Batal</button>
          <button type="submit" class="btn btn-primary">Simpan PIN</button>
        </div>
      </form>`);
    const f = $('fPin');
    f.querySelectorAll('input').forEach(i => i.addEventListener('input', () => { i.value = i.value.replace(/\D/g, ''); }));
    f.addEventListener('submit', async e => {
      e.preventDefault();
      if (!/^\d{4,6}$/.test(f.baru.value)) return U.toast('PIN baru harus 4–6 digit angka', 'err');
      if (f.baru.value !== f.ulang.value) return U.toast('Ulangi PIN baru tidak sama', 'err');
      const btn = f.querySelector('[type=submit]');
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
      try {
        await emp('gantiPin', { pinLama: f.lama.value, pinBaru: f.baru.value }, true);
        closeModal();
        U.toast('PIN berhasil diganti', 'ok');
      } catch (err) {
        U.toast(err.message, 'err');
        btn.disabled = false; btn.textContent = 'Simpan PIN';
      }
    });
  });

  /* ---------- Modal ---------- */
  function openModal(html, wide) {
    $('modal').classList.toggle('wide', !!wide);
    $('modal').innerHTML = html;
    show($('modalWrap'));
    const first = $('modal').querySelector('input');
    first && setTimeout(() => first.focus(), 30);
  }
  function closeModal() { hide($('modalWrap')); $('modal').innerHTML = ''; }
  $('modalWrap').addEventListener('click', e => {
    if (e.target.id === 'modalWrap' || e.target.closest('[data-close]')) closeModal();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { const z = document.querySelector('.zoom'); z ? z.remove() : closeModal(); } });
  document.addEventListener('click', e => {
    const img = e.target.closest('.foto-box .ph img');
    if (!img) return;
    const z = document.createElement('div');
    z.className = 'zoom';
    z.innerHTML = `<img src="${img.src}" alt="">`;
    z.onclick = () => z.remove();
    document.body.appendChild(z);
  });

  /* ---------- Init ---------- */
  if (S.token) { show($('app')); load(); } else showLogin();
})();
