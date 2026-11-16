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
