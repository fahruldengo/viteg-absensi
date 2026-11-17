// Helper bersama: panggilan API (GET-only) & utilitas format.
const CFG = window.APP_CONFIG || {};
const TZ = CFG.TIMEZONE || 'Asia/Makassar';

const API = {
  configured() {
    return /^https:\/\/script\.google\.com\//.test(CFG.API_URL || '');
  },
  async call(action, params = {}) {
    if (!API.configured()) throw new Error('API_URL belum diisi di config.js');
    const url = new URL(CFG.API_URL);
    url.searchParams.set('action', action);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    });
    url.searchParams.set('_', Date.now());
    let res;
    try {
      res = await fetch(url.toString(), { method: 'GET', redirect: 'follow' });
    } catch (e) {
      throw new Error('Tidak dapat terhubung ke server. Periksa koneksi internet.');
    }
    let j;
    try { j = await res.json(); } catch (e) { throw new Error('Respons server tidak valid. Cek deployment Apps Script.'); }
    if (!j.ok) throw new Error(j.error || 'Terjadi kesalahan');
    return j.data;
  },
  // POST text/plain = simple request (tanpa CORS preflight), untuk payload besar (foto)
  async post(action, body = {}) {
    if (!API.configured()) throw new Error('API_URL belum diisi di config.js');
    let res;
    try {
      res = await fetch(CFG.API_URL, { method: 'POST', redirect: 'follow', body: JSON.stringify({ ...body, action }) });
    } catch (e) {
      throw new Error('Tidak dapat terhubung ke server. Periksa koneksi internet.');
    }
    let j;
    try { j = await res.json(); } catch (e) { throw new Error('Respons server tidak valid. Cek deployment Apps Script.'); }
    if (!j.ok) throw new Error(j.error || 'Terjadi kesalahan');
    return j.data;
  }
};

const U = {
  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  parts(d) {
    const o = {};
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).formatToParts(d).forEach(p => { o[p.type] = p.value; });
    if (o.hour === '24') o.hour = '00';
    return o;
  },
  time(d) { const p = U.parts(d); return `${p.hour}:${p.minute}:${p.second}`; },
  isoDate(d) { const p = U.parts(d); return `${p.year}-${p.month}-${p.day}`; },
  longDate(d) {
    return new Intl.DateTimeFormat('id-ID', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  },
  fmtTgl(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-').map(Number);
    return new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(y, m - 1, d)));
  },
  hm(t) { return t ? t.slice(0, 5) : '—'; },
  toMin(t) { const m = String(t || '').match(/^(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; },
  durasi(a, b) {
    const x = U.toMin(a), y = U.toMin(b);
    if (x === null || y === null || y < x) return '—';
    const d = y - x; return `${Math.floor(d / 60)}j ${d % 60}m`;
  },
  menit(n) { n = Number(n) || 0; return n >= 60 ? `${Math.floor(n / 60)}j ${n % 60}m` : `${n}m`; },
  dist(lat1, lng1, lat2, lng2) {
    const R = 6371000, r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  },
  badge(status) {
    if (!status) return '<span class="badge b-none">Belum absen</span>';
    const cls = { 'Hadir': 'b-ok', 'Terlambat': 'b-late', 'Dinas Luar': 'b-info', 'Izin': 'b-info', 'Sakit': 'b-warn', 'Cuti': 'b-info', 'Alpa': 'b-bad' }[status] || 'b-none';
    return `<span class="badge ${cls}">${U.esc(status)}</span>`;
  },
  store: {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  },
  session: {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) {} }
  },
  toast(msg, type = '') {
    const t = document.getElementById('toast');
    if (!t) return alert(msg);
    t.textContent = msg;
    t.className = 'toast show ' + type;
    clearTimeout(U._tt);
    U._tt = setTimeout(() => { t.className = 'toast'; }, 3800);
  }
};

// Komponen laporan kerja harian (dipakai halaman absen, Performa Saya, admin)
const Lap = {
  STATUS: ['Selesai', 'Proses', 'Kendala'],
  CONTOH: 'Contoh: Rekap data penjualan outlet',
  key: t => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim(),
  tglPendek(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
  },
  hariKe(asal, tgl) {
    if (!asal || !tgl) return 1;
    const f = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
    return Math.round((f(tgl) - f(asal)) / 86400000) + 1;
  },
  // Label lanjutan: tampil bila pekerjaan dimulai sebelum tanggal laporan
  tag(it, tgl) {
    if (!it.a || !tgl || it.a >= tgl) return '';
    const n = Lap.hariKe(it.a, tgl);
    return `<span class="lap-tag${n >= 4 ? ' lama' : ''}" title="Dimulai ${U.esc(Lap.tglPendek(it.a))}">Lanjutan · hari ke-${n}</span>`;
  },
  editor(el, items = [], opts = {}) {
    el.innerHTML = `<div class="lap-ed"><div class="lap-rows"></div>
      <button type="button" class="btn btn-ghost btn-sm lap-add">+ Tambah pekerjaan</button></div>`;
    const rows = el.querySelector('.lap-rows');
    const tgl = () => (typeof opts.tanggal === 'function' ? opts.tanggal() : opts.tanggal) || '';
    const addRow = (it = {}, focus) => {
      if (rows.children.length >= 30) { U.toast('Maksimal 30 pekerjaan per hari', 'err'); return false; }
      const r = document.createElement('div');
      r.className = 'lap-row';
      r.dataset.a = it.a || '';
      r.dataset.i = it.i || '';
      r.innerHTML = `<span class="lap-no"></span>
        <div class="lap-tw"><input class="inp lap-t" maxlength="300" placeholder="${U.esc(Lap.CONTOH)}" value="${U.esc(it.t || '')}">${Lap.tag(it, tgl())}</div>
        <select class="inp lap-s">${Lap.STATUS.map(s => `<option ${s === (it.s || 'Selesai') ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <button type="button" class="lap-del" aria-label="Hapus baris">×</button>`;
      const sel = r.querySelector('.lap-s');
      const paint = () => { sel.dataset.s = sel.value; };
      sel.addEventListener('change', () => { paint(); opts.onChange && opts.onChange(); }); paint();
      r.querySelector('.lap-t').addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); addRow({}, true); }
      });
      r.querySelector('.lap-del').addEventListener('click', () => {
        if (rows.children.length > 1) r.remove(); else { r.querySelector('.lap-t').value = ''; r.dataset.a = r.dataset.i = ''; r.querySelector('.lap-tag')?.remove(); }
        renum(); opts.onChange && opts.onChange();
      });
      r.querySelector('.lap-t').addEventListener('input', () => opts.onChange && opts.onChange());
      rows.appendChild(r);
      renum();
      if (focus) r.querySelector('.lap-t').focus();
      return true;
    };
    const renum = () => [...rows.children].forEach((r, i) => { r.querySelector('.lap-no').textContent = i + 1; });
    el.querySelector('.lap-add').addEventListener('click', () => addRow({}, true));
    const api = {
      set(list) { rows.innerHTML = ''; (list && list.length ? list : [{}]).forEach(it => addRow(it)); },
      // Tambah item (mis. pekerjaan lanjutan) tanpa duplikat; isi baris kosong lebih dulu
      add(list) {
        const cur = api.get();
        const sudah = it => cur.some(x => (x.i && it.i && x.i === it.i) || Lap.key(x.t) === Lap.key(it.t));
        [...rows.children].forEach(r => { if (!r.querySelector('.lap-t').value.trim()) r.remove(); });
        let n = 0;
        (list || []).forEach(it => { if (!sudah(it) && addRow(it)) { cur.push(it); n++; } });
        if (!rows.children.length) addRow({});
        renum();
        return n;
      },
      get() {
        return [...rows.children].map(r => ({ t: r.querySelector('.lap-t').value.trim(), s: r.querySelector('.lap-s').value, a: r.dataset.a || '', i: r.dataset.i || '' }))
          .filter(it => it.t);
      },
      disable(d) { el.querySelectorAll('input,select,button').forEach(x => { x.disabled = d; }); }
    };
    api.set(items);
    return api;
  },
  badge(s) {
    return `<span class="badge ${{ Selesai: 'b-ok', Proses: 'b-info', Kendala: 'b-bad' }[s] || 'b-none'}">${U.esc(s)}</span>`;
  },
  view(lap) {
    if (!lap || (!lap.items.length && !lap.catatan)) return '<p class="muted" style="margin:0;font-size:13px">Belum ada laporan kerja.</p>';
    return `<ol class="lap-view">${lap.items.map(it => `<li><span>${U.esc(it.t)}</span>${Lap.badge(it.s)}${Lap.tag(it, lap.tanggal)}</li>`).join('')}</ol>
      ${lap.catatan ? `<div class="lap-note"><b>Catatan / rencana:</b> ${U.esc(lap.catatan)}</div>` : ''}`;
  }
};
