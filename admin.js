// Panel admin absensi
(() => {
  const $ = id => document.getElementById(id);
  const STATUS = ['Hadir', 'Terlambat', 'Dinas Luar', 'Izin', 'Sakit', 'Cuti', 'Alpa'];
  const HADIR = ['Hadir', 'Terlambat', 'Dinas Luar'];
  // Mode Panel Pantau (pantau.html): hanya lihat kehadiran & laporan kerja
  const PANTAU = document.body.dataset.mode === 'pantau';
  const KEY = PANTAU ? 'pnt' : 'adm';
  const S = { token: U.session.get(KEY + '_token'), karyawan: [], absensi: [], settings: null, tab: 'dashboard' };

  const today = () => U.isoDate(new Date());

  /* ---------- API dengan token ---------- */
  async function adm(action, params = {}) {
    try {
      return await API.call(action, { ...params, token: S.token });
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
    $('app').classList.add('hidden');
    $('login').classList.remove('hidden');
    if (!API.configured()) {
      $('loginNotice').textContent = 'API_URL belum diisi di config.js.';
      $('loginNotice').classList.remove('hidden');
    }
    setTimeout(() => $('password').focus(), 50);
  }

  async function showApp() {
    $('login').classList.add('hidden');
    $('app').classList.remove('hidden');
    $('tInstansi').textContent = U.session.get(KEY + '_instansi') || '—';
    await loadKaryawan(true);
    if (!S.token) return; // sesi habis → sudah kembali ke login
    switchTab(S.tab);
  }

  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('btnLogin');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Memeriksa…';
    try {
      const r = await API.call(PANTAU ? 'loginPantau' : 'login', { password: $('password').value });
      S.token = r.token;
      U.session.set(KEY + '_token', r.token);
      U.session.set(KEY + '_instansi', r.nama_instansi);
      $('password').value = '';
      showApp();
    } catch (err) {
      U.toast(err.message, 'err');
    } finally {
      btn.disabled = false; btn.textContent = 'Masuk';
    }
  });

  function logoutLocal() {
    S.token = null;
    U.session.del(KEY + '_token');
    showLogin();
  }

  $('btnLogout').addEventListener('click', async () => {
    try { await API.call('logout', { token: S.token }); } catch (e) {}
    logoutLocal();
  });

  /* ---------- Tabs ---------- */
  function switchTab(tab) {
    S.tab = tab;
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('hidden', p.id !== 'tab-' + tab));
    if (tab === 'dashboard') loadDashboard();
    if (tab === 'absensi' && !S.absensiLoaded) loadAbsensi();
    if (tab === 'karyawan') renderKaryawan();
    if (tab === 'laporan' && !S.laporanLoaded) loadLaporan();
    if (tab === 'pengaturan') loadSettings();
  }
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  /* ================= DASHBOARD ================= */
  $('dTanggal').value = today();
  $('dTanggal').addEventListener('change', loadDashboard);
  $('dToday').addEventListener('click', () => { $('dTanggal').value = today(); loadDashboard(); });
  $('dRefresh').addEventListener('click', loadDashboard);

  async function loadDashboard() {
    const tgl = $('dTanggal').value || today();
    $('dTanggalLabel').textContent = U.fmtTgl(tgl);
    $('dBody').innerHTML = '<tr><td colspan="7" class="loading-row"><span class="spinner"></span></td></tr>';
    try {
      const d = await adm('dashboard', { tanggal: tgl });
      const c = d.ringkas;
      const pct = n => c.total ? Math.round(n / c.total * 100) + '%' : '0%';
      $('dStats').innerHTML = [
        ['Karyawan aktif', c.total, '', 's-none'],
        ['Hadir', c.hadir, pct(c.hadir) + ' · ' + c.pulang + ' sudah pulang', 's-ok'],
        ['Terlambat', c.terlambat, pct(c.terlambat), 's-late'],
        ['Izin / Sakit / Cuti', c.tidak, pct(c.tidak), 's-info'],
        ['Alpa', c.alpa, pct(c.alpa), 's-bad'],
        ['Belum absen', c.belum, pct(c.belum), 's-none']
      ].map(([l, v, s, cls]) => `<div class="stat ${cls}"><span>${l}</span><b>${v}</b><small>${s}</small></div>`).join('');

      if (!d.list.length) {
        $('dBody').innerHTML = '<tr><td colspan="7" class="empty">Belum ada karyawan aktif. Tambahkan di tab Karyawan.</td></tr>';
        return;
      }
      $('dBody').innerHTML = d.list.map(x => {
        const r = x.rec;
        return `<tr>
          <td><b>${U.esc(x.nama)}</b><span class="sub">${U.esc(x.id)}${x.jabatan ? ' · ' + U.esc(x.jabatan) : ''}</span></td>
          <td class="num">${r ? U.hm(r.jamMasuk) : '—'}${r && r.telat ? `<span class="sub" style="color:var(--late)">+${U.menit(r.telat)}</span>` : ''}</td>
          <td class="num">${r ? U.hm(r.jamPulang) : '—'}</td>
          <td class="num">${r ? U.durasi(r.jamMasuk, r.jamPulang) : '—'}</td>
          <td>${U.badge(r && r.status)}</td>
          <td>${r && r.ket ? U.esc(r.ket) : '<span class="muted">—</span>'}</td>
          <td class="act">${r
            ? `<button class="btn btn-ghost btn-sm" data-detail="${U.esc(r.id)}">Detail</button>${PANTAU ? '' : `<button class="btn btn-ghost btn-sm" data-edit="${U.esc(r.id)}">Edit</button>`}`
            : (PANTAU ? '' : `<button class="btn btn-ghost btn-sm" data-isi="${U.esc(x.id)}">Isi</button>`)}</td>
        </tr>`;
      }).join('');
      S.dashList = d.list;
    } catch (e) {
      $('dBody').innerHTML = `<tr><td colspan="7" class="empty">${U.esc(e.message)}</td></tr>`;
    }
  }

  $('dBody').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const tgl = $('dTanggal').value || today();
    if (b.dataset.isi) openAbsensiForm({ tanggal: tgl, karyawanId: b.dataset.isi, status: 'Izin' }, loadDashboard);
    const id = b.dataset.edit || b.dataset.detail;
    const x = id && (S.dashList || []).find(i => i.rec && i.rec.id === id);
    if (x && b.dataset.edit) openAbsensiForm(x.rec, loadDashboard);
    if (x && b.dataset.detail) openDetail(x.rec);
  });

  /* ================= ABSENSI ================= */
  (function initFilter() {
    const t = today();
    $('aDari').value = t.slice(0, 8) + '01';
    $('aSampai').value = t;
    $('aStatus').innerHTML = '<option value="">Semua status</option>' + STATUS.map(s => `<option>${s}</option>`).join('');
  })();

  $('aLoad').addEventListener('click', loadAbsensi);
  $('aAdd')?.addEventListener('click', () => openAbsensiForm({ tanggal: today(), status: 'Hadir' }, loadAbsensi));
  $('aExport').addEventListener('click', exportCSV);

  async function loadAbsensi() {
    const dari = $('aDari').value, sampai = $('aSampai').value;
    if (dari && sampai && dari > sampai) return U.toast('Tanggal awal melebihi tanggal akhir', 'err');
    $('aBody').innerHTML = '<tr><td colspan="9" class="loading-row"><span class="spinner"></span></td></tr>';
    try {
      S.absensi = await adm('absensi', { dari, sampai, karyawanId: $('aKaryawan').value, status: $('aStatus').value });
      S.absensiLoaded = true;
      renderAbsensi();
    } catch (e) {
      $('aBody').innerHTML = `<tr><td colspan="9" class="empty">${U.esc(e.message)}</td></tr>`;
    }
  }

  function mapLink(loc, label) {
    return loc ? `<a class="loc-link" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${encodeURIComponent(loc)}">${label}</a>` : '';
  }

  function renderAbsensi() {
    const list = S.absensi;
    $('aInfo').textContent = `${list.length} catatan · ${U.fmtTgl($('aDari').value)} – ${U.fmtTgl($('aSampai').value)}`;
    if (!list.length) {
      $('aBody').innerHTML = '<tr><td colspan="9" class="empty">Tidak ada data pada filter ini.</td></tr>';
    } else {
      $('aBody').innerHTML = list.map(r => {
        const loc = [mapLink(r.lokasiMasuk, 'Masuk'), mapLink(r.lokasiPulang, 'Pulang')].filter(Boolean).join(' · ');
        return `<tr>
          <td class="num">${U.fmtTgl(r.tanggal)}</td>
          <td><b>${U.esc(r.nama)}</b><span class="sub">${U.esc(r.karyawanId)}</span></td>
          <td class="num">${U.hm(r.jamMasuk)}${r.telat ? `<span class="sub" style="color:var(--late)">+${U.menit(r.telat)}</span>` : ''}</td>
          <td class="num">${U.hm(r.jamPulang)}</td>
          <td class="num">${U.durasi(r.jamMasuk, r.jamPulang)}</td>
          <td>${U.badge(r.status)}</td>
          <td>${loc || '<span class="muted">—</span>'}${r.jarak ? `<span class="sub">${U.esc(r.jarak)} m</span>` : ''}</td>
          <td>${r.ket ? U.esc(r.ket) : '<span class="muted">—</span>'}</td>
          <td class="act"><button class="btn btn-ghost btn-sm" data-detail="${U.esc(r.id)}">Detail</button>${PANTAU ? '' : `<button class="btn btn-ghost btn-sm" data-edit="${U.esc(r.id)}">Edit</button><button class="btn btn-danger btn-sm" data-del="${U.esc(r.id)}">Hapus</button>`}</td>
        </tr>`;
      }).join('');
    }
    renderRekap();
  }

  function renderRekap() {
    const m = {};
    S.absensi.forEach(r => {
      const x = m[r.karyawanId] || (m[r.karyawanId] = { nama: r.nama, id: r.karyawanId, Hadir: 0, Terlambat: 0, 'Dinas Luar': 0, Izin: 0, Sakit: 0, Cuti: 0, Alpa: 0, telat: 0 });
      x[r.status] = (x[r.status] || 0) + 1;
      x.telat += r.telat || 0;
    });
    const rows = Object.values(m).sort((a, b) => a.nama.localeCompare(b.nama));
    $('rBody').innerHTML = rows.length ? rows.map(x => `<tr>
      <td><b>${U.esc(x.nama)}</b><span class="sub">${U.esc(x.id)}</span></td>
      <td class="num">${x.Hadir + x.Terlambat + x['Dinas Luar']}</td>
      <td class="num">${x.Terlambat}</td>
      <td class="num">${x.telat ? U.menit(x.telat) : '—'}</td>
      <td class="num">${x['Dinas Luar']}</td>
      <td class="num">${x.Izin}</td><td class="num">${x.Sakit}</td><td class="num">${x.Cuti}</td><td class="num">${x.Alpa}</td>
    </tr>`).join('') : '<tr><td colspan="9" class="empty">—</td></tr>';
  }

  $('aBody').addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.edit) {
      const r = S.absensi.find(x => x.id === b.dataset.edit);
      if (r) openAbsensiForm(r, loadAbsensi);
    }
    if (b.dataset.detail) {
      const r = S.absensi.find(x => x.id === b.dataset.detail);
      if (r) openDetail(r);
    }
    if (b.dataset.del) {
      const r = S.absensi.find(x => x.id === b.dataset.del);
      if (!r || !confirm(`Hapus absensi ${r.nama} tanggal ${U.fmtTgl(r.tanggal)}?`)) return;
      b.disabled = true;
      try {
        await adm('deleteAbsensi', { id: r.id });
        U.toast('Data absensi dihapus', 'ok');
        loadAbsensi();
      } catch (err) { U.toast(err.message, 'err'); b.disabled = false; }
    }
  });

  function exportCSV() {
    if (!S.absensi.length) return U.toast('Tidak ada data untuk diekspor', 'err');
    const head = ['Tanggal', 'ID Karyawan', 'Nama', 'Jam Masuk', 'Jam Pulang', 'Durasi', 'Status', 'Telat (menit)', 'Lokasi Masuk', 'Lokasi Pulang', 'Jarak Masuk (m)', 'Alamat Masuk', 'Alamat Pulang', 'Foto Masuk', 'Foto Pulang', 'Keterangan'];
    const fl = id => id ? 'https://drive.google.com/file/d/' + id + '/view' : '';
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [head.map(q).join(';')].concat(
      [...S.absensi].reverse().map(r => [r.tanggal, r.karyawanId, r.nama, r.jamMasuk, r.jamPulang, U.durasi(r.jamMasuk, r.jamPulang).replace('—', ''),
        r.status, r.telat, r.lokasiMasuk, r.lokasiPulang, r.jarak, r.alamatMasuk, r.alamatPulang, fl(r.fotoMasuk), fl(r.fotoPulang), r.ket].map(q).join(';'))
    );
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `absensi_${$('aDari').value}_sd_${$('aSampai').value}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- Form absensi (tambah / edit) ---------- */
  function openAbsensiForm(r, after) {
    const edit = !!r.id;
    const opts = S.karyawan
      .filter(k => k.status === 'Aktif' || k.id === r.karyawanId)
      .map(k => `<option value="${U.esc(k.id)}" ${k.id === r.karyawanId ? 'selected' : ''}>${U.esc(k.nama)} · ${U.esc(k.id)}</option>`).join('');
    openModal(`
      <h3>${edit ? 'Edit Absensi' : 'Tambah Absensi Manual'}</h3>
      <p class="muted" style="margin:0;font-size:13px">${edit ? U.esc(r.nama) + ' · ' + U.fmtTgl(r.tanggal) : 'Untuk izin, sakit, cuti, alpa, dinas luar, atau koreksi lupa absen.'}</p>
      <form id="fAbs">
        <div class="form-grid">
          <div class="full"><label class="lbl">Karyawan</label>
            <select name="karyawanId" class="inp" required ${edit ? 'disabled' : ''}><option value="">— Pilih —</option>${opts}</select></div>
          <div><label class="lbl">Tanggal</label><input name="tanggal" type="date" class="inp" value="${U.esc(r.tanggal || '')}" required ${edit ? 'disabled' : ''}></div>
          <div><label class="lbl">Status</label><select name="status" class="inp">${STATUS.map(s => `<option ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
          <div class="jam"><label class="lbl">Jam masuk</label><input name="jamMasuk" type="time" class="inp" value="${U.esc((r.jamMasuk || '').slice(0, 5))}"></div>
          <div class="jam"><label class="lbl">Jam pulang</label><input name="jamPulang" type="time" class="inp" value="${U.esc((r.jamPulang || '').slice(0, 5))}"></div>
          <div class="full"><label class="lbl">Keterangan</label><textarea name="ket" class="inp" maxlength="300" placeholder="Opsional">${U.esc(r.ket || '')}</textarea></div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-close>Batal</button>
          <button type="submit" class="btn btn-primary">Simpan</button>
        </div>
      </form>`);
    const f = $('fAbs');
    const toggleJam = () => {
      const show = HADIR.includes(f.status.value);
      f.querySelectorAll('.jam').forEach(el => el.classList.toggle('hidden', !show));
      if (!show) { f.jamMasuk.value = ''; f.jamPulang.value = ''; }
    };
    const autoStatus = () => {
      // Sarankan Hadir/Terlambat otomatis dari jam masuk
      if (!S.settings || !['Hadir', 'Terlambat'].includes(f.status.value) || !f.jamMasuk.value) return;
      const late = U.toMin(f.jamMasuk.value) - U.toMin(S.settings.jam_masuk) > Number(S.settings.toleransi_menit);
      f.status.value = late ? 'Terlambat' : 'Hadir';
    };
    f.status.addEventListener('change', toggleJam);
    f.jamMasuk.addEventListener('change', autoStatus);
    toggleJam();
    ensureSettings();

    f.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = f.querySelector('[type=submit]');
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
      try {
        await adm('saveAbsensi', {
          id: r.id || '',
          karyawanId: edit ? r.karyawanId : f.karyawanId.value,
          tanggal: edit ? r.tanggal : f.tanggal.value,
          status: f.status.value,
          jamMasuk: f.jamMasuk.value,
          jamPulang: f.jamPulang.value,
          ket: f.ket.value.trim()
        });
        closeModal();
        U.toast('Absensi disimpan', 'ok');
        S.absensiLoaded = false;
        after && after();
      } catch (err) {
        U.toast(err.message, 'err');
        btn.disabled = false; btn.textContent = 'Simpan';
      }
    });
  }

  /* ---------- Detail foto & lokasi ---------- */
  const fotoCache = new Map();
  const hasDetail = r => !!r;

  function fotoBox(label, jam, fotoId, lokasi, alamat, extra) {
    return `<div class="foto-box">
      <div class="ph${fotoId ? '' : ' none'}" ${fotoId ? `data-foto="${U.esc(fotoId)}"` : ''}>${fotoId ? '<span class="spinner"></span>' : 'Tidak ada foto'}</div>
      <div class="meta"><b>${label} · ${U.hm(jam)}</b>
        ${alamat ? U.esc(alamat) + '<br>' : ''}
        ${lokasi ? `${U.esc(lokasi)} · ${mapLink(lokasi, 'Buka peta')}` : '<span class="muted">Lokasi tidak tercatat</span>'}
        ${extra || ''}
      </div></div>`;
  }

  function openDetail(r) {
    openModal(`
      <h3>${U.esc(r.nama)}</h3>
      <p class="muted" style="margin:0;font-size:13px">${U.esc(r.karyawanId)} · ${U.fmtTgl(r.tanggal)} · ${U.badge(r.status)}</p>
      <div class="foto-grid">
        ${fotoBox('Masuk', r.jamMasuk, r.fotoMasuk, r.lokasiMasuk, r.alamatMasuk, r.jarak ? `<br>${U.esc(r.jarak)} m dari kantor` : '')}
        ${fotoBox('Pulang', r.jamPulang, r.fotoPulang, r.lokasiPulang, r.alamatPulang)}
      </div>
      <div class="lap-section"><div class="lbl">Laporan kerja</div><div id="dLap"><span class="spinner"></span></div></div>
      <div class="form-actions"><button type="button" class="btn btn-ghost" data-close>Tutup</button></div>`);
    $('modal').classList.add('wide');
    adm('laporan', { dari: r.tanggal, sampai: r.tanggal, karyawanId: r.karyawanId })
      .then(l => { const el = $('dLap'); if (el) el.innerHTML = Lap.view(l[0]); })
      .catch(e => { const el = $('dLap'); if (el) el.textContent = e.message; });
    $('modal').querySelectorAll('[data-foto]').forEach(async el => {
      const id = el.dataset.foto;
      try {
        if (!fotoCache.has(id)) fotoCache.set(id, await adm('foto', { id }));
        const f = fotoCache.get(id);
        el.innerHTML = `<img src="${f.data}" alt="Foto absen">`;
        if (!PANTAU) el.insertAdjacentHTML('afterend', `<div class="meta" style="padding-top:0"><a class="loc-link" href="${U.esc(f.url)}" target="_blank" rel="noopener">Buka di Google Drive</a></div>`);
      } catch (e) {
        el.textContent = e.message;
      }
    });
  }

  document.addEventListener('click', e => {
    const img = e.target.closest('.foto-box .ph img');
    if (img) {
      const z = document.createElement('div');
      z.className = 'zoom';
      z.innerHTML = `<img src="${img.src}" alt="">`;
      z.onclick = () => z.remove();
      document.body.appendChild(z);
      return;
    }
  });

  /* ================= LAPORAN KERJA ================= */
  (function initLapFilter() {
    $('lDari').value = $('lSampai').value = today();
  })();
  $('lLoad').addEventListener('click', loadLaporan);
  $('lExport').addEventListener('click', exportLaporan);

  async function loadLaporan() {
    const dari = $('lDari').value, sampai = $('lSampai').value;
    if (dari && sampai && dari > sampai) return U.toast('Tanggal awal melebihi tanggal akhir', 'err');
    $('lBody').innerHTML = '<div class="loading-row"><span class="spinner"></span></div>';
    $('lMissing').innerHTML = '';
    try {
      S.laporan = await adm('laporan', { dari, sampai, karyawanId: $('lKaryawan').value });
      S.laporanLoaded = true;
      renderLaporan(dari, sampai);
    } catch (e) {
      $('lBody').innerHTML = `<div class="empty">${U.esc(e.message)}</div>`;
    }
  }

  function renderLaporan(dari, sampai) {
    const list = S.laporan;
    const nItem = list.reduce((a, l) => a + l.items.length, 0);
    const nKendala = list.reduce((a, l) => a + l.items.filter(i => i.s === 'Kendala').length, 0);
    $('lInfo').textContent = `${list.length} laporan · ${nItem} pekerjaan${nKendala ? ` · ${nKendala} kendala` : ''} · ${U.fmtTgl(dari)}${dari !== sampai ? ' – ' + U.fmtTgl(sampai) : ''}`;

    // Satu hari tanpa filter karyawan → tampilkan yang belum mengisi
    if (dari === sampai && !$('lKaryawan').value) {
      const sudah = new Set(list.map(l => l.karyawanId));
      const belum = S.karyawan.filter(k => k.status === 'Aktif' && !sudah.has(k.id));
      $('lMissing').innerHTML = belum.length
        ? `<div class="lap-missing"><b>Belum mengisi (${belum.length}):</b> ${belum.map(k => U.esc(k.nama)).join(', ')}</div>` : '';
    }
    if (!list.length) { $('lBody').innerHTML = '<div class="card empty">Belum ada laporan kerja pada rentang ini.</div>'; return; }

    const groups = {};
    list.forEach(l => { (groups[l.tanggal] = groups[l.tanggal] || []).push(l); });
    $('lBody').innerHTML = Object.keys(groups).sort().reverse().map(tgl => `
      <div class="lap-group">
        <h3>${U.fmtTgl(tgl)} · ${groups[tgl].length} laporan</h3>
        <div class="lap-list">${groups[tgl].map(l => `
          <article class="card lap-item">
            <header><div><b>${U.esc(l.nama)}</b> <small>${U.esc(l.karyawanId)}</small></div><small>diubah ${U.esc(l.diubah.slice(11, 16))}</small></header>
            ${Lap.view(l)}
          </article>`).join('')}</div>
      </div>`).join('');
  }

  function exportLaporan() {
    if (!S.laporan || !S.laporan.length) return U.toast('Tidak ada laporan untuk diekspor', 'err');
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Tanggal', 'ID Karyawan', 'Nama', 'No', 'Pekerjaan', 'Status', 'Catatan / Rencana', 'Diubah'].map(q).join(';')];
    [...S.laporan].reverse().forEach(l => {
      const items = l.items.length ? l.items : [{ t: '', s: '' }];
      items.forEach((it, i) => lines.push([l.tanggal, l.karyawanId, l.nama, l.items.length ? i + 1 : '', it.t, it.s, i === 0 ? l.catatan : '', l.diubah].map(q).join(';')));
    });
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `laporan_kerja_${$('lDari').value}_sd_${$('lSampai').value}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ================= KARYAWAN ================= */
  async function loadKaryawan(silent) {
    try {
      S.karyawan = await adm('karyawan');
      $('aKaryawan').innerHTML = $('lKaryawan').innerHTML = '<option value="">Semua karyawan</option>' +
        S.karyawan.map(k => `<option value="${U.esc(k.id)}">${U.esc(k.nama)} · ${U.esc(k.id)}</option>`).join('');
      if (S.tab === 'karyawan') renderKaryawan();
      return true;
    } catch (e) { if (!silent) U.toast(e.message, 'err'); return false; }
  }

  $('kCari')?.addEventListener('input', renderKaryawan);
  $('kAdd')?.addEventListener('click', () => openKaryawanForm(null));

  function renderKaryawan() {
    const q = $('kCari').value.trim().toLowerCase();
    const list = S.karyawan.filter(k => !q || [k.id, k.nama, k.jabatan, k.divisi].join(' ').toLowerCase().includes(q));
    const aktif = S.karyawan.filter(k => k.status === 'Aktif').length;
    $('kInfo').textContent = `${S.karyawan.length} karyawan · ${aktif} aktif`;
    $('kBody').innerHTML = list.length ? list.map(k => `<tr>
      <td class="num"><b>${U.esc(k.id)}</b></td>
      <td>${U.esc(k.nama)}</td>
      <td>${U.esc(k.jabatan) || '<span class="muted">—</span>'}</td>
      <td>${U.esc(k.divisi) || '<span class="muted">—</span>'}</td>
      <td>${k.status === 'Aktif' ? '<span class="badge b-ok">Aktif</span>' : '<span class="badge b-none">Nonaktif</span>'}</td>
      <td class="act"><button class="btn btn-ghost btn-sm" data-edit="${U.esc(k.id)}">Edit</button><button class="btn btn-danger btn-sm" data-del="${U.esc(k.id)}">Hapus</button></td>
    </tr>`).join('') : `<tr><td colspan="6" class="empty">${S.karyawan.length ? 'Tidak ada yang cocok.' : 'Belum ada karyawan. Klik “+ Tambah Karyawan”.'}</td></tr>`;
  }

  $('kBody')?.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    const k = S.karyawan.find(x => x.id === (b.dataset.edit || b.dataset.del));
    if (!k) return;
    if (b.dataset.edit) return openKaryawanForm(k);
    if (!confirm(`Hapus karyawan ${k.nama} (${k.id})?\n\nRiwayat absensinya tetap tersimpan. Jika hanya ingin menonaktifkan, gunakan Edit → Status Nonaktif.`)) return;
    b.disabled = true;
    try {
      await adm('deleteKaryawan', { id: k.id });
      U.toast('Karyawan dihapus', 'ok');
      loadKaryawan();
    } catch (err) { U.toast(err.message, 'err'); b.disabled = false; }
  });

  function openKaryawanForm(k) {
    const edit = !!k;
    k = k || { status: 'Aktif' };
    openModal(`
      <h3>${edit ? 'Edit Karyawan' : 'Tambah Karyawan'}</h3>
      <form id="fKar">
        <div class="form-grid">
          <div><label class="lbl">ID / NIK</label><input name="kid" class="inp" value="${U.esc(k.id || '')}" ${edit ? 'disabled' : ''} placeholder="Otomatis jika kosong" maxlength="20"></div>
          <div><label class="lbl">Status</label><select name="status" class="inp"><option ${k.status === 'Aktif' ? 'selected' : ''}>Aktif</option><option ${k.status === 'Nonaktif' ? 'selected' : ''}>Nonaktif</option></select></div>
          <div class="full"><label class="lbl">Nama lengkap</label><input name="nama" class="inp" value="${U.esc(k.nama || '')}" required></div>
          <div><label class="lbl">Jabatan</label><input name="jabatan" class="inp" value="${U.esc(k.jabatan || '')}"></div>
          <div><label class="lbl">Divisi</label><input name="divisi" class="inp" value="${U.esc(k.divisi || '')}"></div>
          <div class="full"><label class="lbl">PIN absen ${edit ? '' : '*'}</label>
            <input name="pin" class="inp" inputmode="numeric" maxlength="6" ${edit ? 'placeholder="Kosongkan jika tidak diubah"' : 'required placeholder="4–6 digit angka"'}>
            <div class="hint">Berikan PIN ini kepada karyawan. PIN disimpan terenkripsi (hash) dan tidak bisa dilihat lagi.</div></div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-close>Batal</button>
          <button type="submit" class="btn btn-primary">Simpan</button>
        </div>
      </form>`);
    const f = $('fKar');
    f.pin.addEventListener('input', () => { f.pin.value = f.pin.value.replace(/\D/g, ''); });
    if (!edit) {
      const gen = document.createElement('button');
      gen.type = 'button'; gen.className = 'btn btn-ghost btn-sm'; gen.textContent = 'Buat PIN acak';
      gen.style.marginTop = '8px';
      gen.onclick = () => { f.pin.value = String(Math.floor(1000 + Math.random() * 9000)); };
      f.pin.after(gen);
    }
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const pin = f.pin.value.trim();
      if (pin && !/^\d{4,6}$/.test(pin)) return U.toast('PIN harus 4–6 digit angka', 'err');
      const btn = f.querySelector('[type=submit]');
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
      try {
        const res = await adm('saveKaryawan', {
          mode: edit ? 'edit' : 'baru',
          id: edit ? k.id : f.kid.value.trim(),
          nama: f.nama.value.trim(), jabatan: f.jabatan.value.trim(), divisi: f.divisi.value.trim(),
          status: f.status.value, pin
        });
        closeModal();
        U.toast(edit ? 'Data karyawan diperbarui' : `Karyawan ditambahkan dengan ID ${res.id}${pin ? ' · PIN ' + pin : ''}`, 'ok');
        loadKaryawan();
      } catch (err) {
        U.toast(err.message, 'err');
        btn.disabled = false; btn.textContent = 'Simpan';
      }
    });
  }

  /* ================= PENGATURAN ================= */
  async function ensureSettings() {
    if (!S.settings) { try { S.settings = await adm('settings'); } catch (e) {} }
    return S.settings;
  }

  async function loadSettings() {
    try {
      const s = S.settings = await adm('settings');
      $('s_nama').value = s.nama_instansi;
      $('s_masuk').value = s.jam_masuk;
      $('s_pulang').value = s.jam_pulang;
      $('s_tol').value = s.toleransi_menit;
      $('s_lat').value = s.kantor_lat;
      $('s_lng').value = s.kantor_lng;
      $('s_rad').value = s.radius_meter;
      $('s_foto').value = s.wajib_foto === 'tidak' ? 'tidak' : 'ya';
      $('s_acc').value = s.akurasi_maks;
      $('s_lap').value = s.wajib_laporan === 'ya' ? 'ya' : 'tidak';
      $('s_laphari').value = s.laporan_edit_hari;
      $('s_pw').value = $('s_pw2').value = '';
      renderPantauStatus(s);
    } catch (e) { U.toast(e.message, 'err'); }
  }

  function renderPantauStatus(s) {
    const el = $('pantauStatus');
    if (!el) return;
    el.className = 'badge ' + (s.pantau_aktif ? 'b-ok' : 'b-none');
    el.textContent = s.pantau_aktif ? 'Aktif' : 'Belum aktif — isi password untuk mengaktifkan';
    $('s_ppw').value = $('s_ppw2').value = '';
    $('s_pnon').checked = false;
    $('s_pnon').disabled = !s.pantau_aktif;
  }

  $('sMyLoc')?.addEventListener('click', () => {
    if (!navigator.geolocation) return U.toast('Perangkat tidak mendukung lokasi', 'err');
    const b = $('sMyLoc'); b.disabled = true; b.textContent = 'Mendeteksi…';
    navigator.geolocation.getCurrentPosition(p => {
      $('s_lat').value = p.coords.latitude.toFixed(6);
      $('s_lng').value = p.coords.longitude.toFixed(6);
      U.toast(`Lokasi diisi (akurasi ±${Math.round(p.coords.accuracy)} m). Klik Simpan.`, 'ok');
      b.disabled = false; b.textContent = 'Gunakan lokasi saya sekarang';
    }, err => {
      U.toast(err.code === 1 ? 'Izin lokasi ditolak' : 'Gagal mendapatkan lokasi', 'err');
      b.disabled = false; b.textContent = 'Gunakan lokasi saya sekarang';
    }, { enableHighAccuracy: true, timeout: 15000 });
  });

  $('sForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const pw = $('s_pw').value;
    if (pw && pw !== $('s_pw2').value) return U.toast('Ulangi password tidak sama', 'err');
    const ppw = $('s_ppw').value, pnon = $('s_pnon').checked;
    if (ppw && ppw !== $('s_ppw2').value) return U.toast('Ulangi password Panel Pantau tidak sama', 'err');
    if (pnon && !confirm('Nonaktifkan Panel Pantau? Semua yang sedang masuk akan keluar.')) return;
    const btn = $('sSave');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Menyimpan…';
    try {
      const s = S.settings = await adm('saveSettings', {
        nama_instansi: $('s_nama').value.trim(),
        jam_masuk: $('s_masuk').value, jam_pulang: $('s_pulang').value,
        toleransi_menit: $('s_tol').value, radius_meter: $('s_rad').value,
        kantor_lat: $('s_lat').value.trim(), kantor_lng: $('s_lng').value.trim(),
        wajib_foto: $('s_foto').value, akurasi_maks: $('s_acc').value,
        wajib_laporan: $('s_lap').value, laporan_edit_hari: $('s_laphari').value,
        password_baru: pw,
        pantau_password_baru: pnon ? '' : ppw,
        pantau_nonaktif: pnon ? 'ya' : ''
      });
      renderPantauStatus(s);
      U.session.set(KEY + '_instansi', s.nama_instansi);
      $('tInstansi').textContent = s.nama_instansi;
      $('s_pw').value = $('s_pw2').value = '';
      U.toast('Pengaturan disimpan' + (pw ? ' · password admin diganti' : '') + (ppw && !pnon ? ' · password Panel Pantau diset' : '') + (pnon ? ' · Panel Pantau dinonaktifkan' : ''), 'ok');
    } catch (err) {
      U.toast(err.message, 'err');
    } finally {
      btn.disabled = false; btn.textContent = 'Simpan Pengaturan';
    }
  });

  /* ================= MODAL ================= */
  function openModal(html) {
    $('modal').classList.remove('wide');
    $('modal').innerHTML = html;
    $('modalWrap').classList.remove('hidden');
    const first = $('modal').querySelector('input:not([disabled]), select:not([disabled])');
    first && setTimeout(() => first.focus(), 30);
  }
  function closeModal() { $('modalWrap').classList.add('hidden'); $('modal').innerHTML = ''; $('modal').classList.remove('wide'); }
  $('modalWrap').addEventListener('click', e => {
    if (e.target.id === 'modalWrap' || e.target.closest('[data-close]')) closeModal();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('modalWrap').classList.contains('hidden')) closeModal(); });

  /* ================= INIT ================= */
  if (S.token) showApp(); else showLogin();
})();
