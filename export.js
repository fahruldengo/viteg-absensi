// Export Excel (.xlsx) & PDF untuk Data Absensi dan Laporan Kerja.
// Pustaka dimuat dari CDN hanya saat tombol download diklik.
const Export = (() => {
  const LIB = {
    exceljs: 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
    jspdf: 'https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js',
    autotable: 'https://cdn.jsdelivr.net/npm/jspdf-autotable@5.0.9/dist/jspdf.plugin.autotable.min.js'
  };
  const NAVY = '01008A', NAVY_RGB = [1, 0, 138];
  const STATUS_WARNA = {
    'Hadir': ['0E7A6D', 'DCEFEB'], 'Terlambat': ['B4530B', 'FBEAD9'], 'Dinas Luar': ['2F5FB3', 'E1EAFA'],
    'Izin': ['2F5FB3', 'E1EAFA'], 'Cuti': ['2F5FB3', 'E1EAFA'], 'Sakit': ['8A6A00', 'FBF1CC'], 'Alpa': ['B42318', 'FDE4E1'],
    'Selesai': ['0E7A6D', 'DCEFEB'], 'Proses': ['2F5FB3', 'E1EAFA'], 'Kendala': ['B42318', 'FDE4E1']
  };
  const HADIR = ['Hadir', 'Terlambat', 'Dinas Luar'];
  const hex2rgb = h => [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));

  /* ---------- util ---------- */
  const loaded = {};
  function load(url) {
    if (!loaded[url]) {
      loaded[url] = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = url; s.async = true;
        s.onload = res;
        s.onerror = () => { delete loaded[url]; rej(new Error('Gagal memuat pustaka export. Periksa koneksi internet.')); };
        document.head.appendChild(s);
      });
    }
    return loaded[url];
  }
  async function libExcel() { await load(LIB.exceljs); return window.ExcelJS; }
  async function libPdf() {
    await load(LIB.jspdf);
    await load(LIB.autotable);
    return window.jspdf.jsPDF;
  }
  let logoCache = null;
  async function logo() {
    if (logoCache) return logoCache;
    try {
      const b = await (await fetch('assets/logo.png')).blob();
      const data = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
      const img = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = data; });
      logoCache = { data, w: img ? img.naturalWidth : 339, h: img ? img.naturalHeight : 360 };
    } catch (e) { logoCache = { data: null }; }
    return logoCache;
  }
  function simpan(blob, nama) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nama;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const dicetak = () => new Intl.DateTimeFormat('id-ID', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date());
  const periodeTeks = m => m.dari === m.sampai ? U.fmtTgl(m.dari) : `${U.fmtTgl(m.dari)} – ${U.fmtTgl(m.sampai)}`;
  const mapsUrl = loc => loc ? 'https://www.google.com/maps?q=' + encodeURIComponent(loc) : '';
  const fotoUrl = id => id ? 'https://drive.google.com/file/d/' + id + '/view' : '';
  const durasiMenit = (a, b) => { const x = U.toMin(a), y = U.toMin(b); return x === null || y === null || y < x ? null : y - x; };

  function rekapAbsensi(list) {
    const m = {};
    list.forEach(r => {
      const x = m[r.karyawanId] || (m[r.karyawanId] = { id: r.karyawanId, nama: r.nama, hadir: 0, tepat: 0, terlambat: 0, telat: 0, dinas: 0, izin: 0, sakit: 0, cuti: 0, alpa: 0, kerja: 0, nKerja: 0 });
      if (HADIR.includes(r.status)) {
        x.hadir++;
        if (r.status === 'Terlambat') { x.terlambat++; x.telat += r.telat || 0; }
        else if (r.status === 'Dinas Luar') x.dinas++; else x.tepat++;
        const d = durasiMenit(r.jamMasuk, r.jamPulang);
        if (d !== null) { x.kerja += d; x.nKerja++; }
      } else if (r.status === 'Izin') x.izin++;
      else if (r.status === 'Sakit') x.sakit++;
      else if (r.status === 'Cuti') x.cuti++;
      else if (r.status === 'Alpa') x.alpa++;
    });
    return Object.values(m).sort((a, b) => a.nama.localeCompare(b.nama));
  }
  const pctTepat = x => (x.tepat + x.terlambat) ? Math.round(x.tepat / (x.tepat + x.terlambat) * 100) + '%' : '—';

  function rekapLaporan(list) {
    const m = {};
    list.forEach(l => {
      const x = m[l.karyawanId] || (m[l.karyawanId] = { id: l.karyawanId, nama: l.nama, laporan: 0, item: 0, selesai: 0, proses: 0, kendala: 0, lanjut: 0 });
      x.laporan++;
      l.items.forEach(it => {
        x.item++;
        if (it.s === 'Selesai') x.selesai++; else if (it.s === 'Proses') x.proses++; else if (it.s === 'Kendala') x.kendala++;
        if (it.a && it.a < l.tanggal && it.s !== 'Selesai') x.lanjut++;
      });
    });
    return Object.values(m).sort((a, b) => a.nama.localeCompare(b.nama));
  }

  /* ================= EXCEL ================= */
  const BORDER = { style: 'thin', color: { argb: 'FFD9D6CB' } };
  const BORDERS = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };

  async function sheetBaru(wb, nama, meta, judul, cols, orientasi) {
    const ws = wb.addWorksheet(nama, {
      pageSetup: { paperSize: 9, orientation: orientasi || 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
      headerFooter: { oddFooter: '&L' + meta.instansi + '&RHalaman &P dari &N' }
    });
    ws.columns = cols.map(c => ({ key: c.key, width: c.w }));
    const last = cols.length;
    const lg = await logo();
    if (lg.data) {
      const id = wb.addImage({ base64: lg.data, extension: 'png' });
      const h = 62, w = Math.round(h * lg.w / lg.h);
      ws.addImage(id, { tl: { col: 0.15, row: 0.15 }, ext: { width: w, height: h } });
    }
    const baris = [
      [judul, { bold: true, size: 16, color: { argb: 'FF' + NAVY } }],
      [meta.instansi, { bold: true, size: 11, color: { argb: 'FF15181E' } }],
      [`Periode: ${periodeTeks(meta)}${meta.filter ? '   ·   ' + meta.filter : ''}`, { size: 10, color: { argb: 'FF4A505C' } }],
      [`Dicetak: ${dicetak()}`, { size: 9, italic: true, color: { argb: 'FF8A909B' } }]
    ];
    baris.forEach(([t, f], i) => {
      const r = i + 1;
      ws.mergeCells(r, 2, r, last);
      const c = ws.getCell(r, 2);
      c.value = t; c.font = { name: 'Calibri', ...f }; c.alignment = { vertical: 'middle' };
      ws.getRow(r).height = i === 0 ? 24 : 17;
    });
    ws.getColumn(1).width = Math.max(ws.getColumn(1).width || 0, 11);
    return ws;
  }

  function tabelExcel(ws, startRow, cols, rows, opts = {}) {
    const hr = ws.getRow(startRow);
    cols.forEach((c, i) => {
      const cell = hr.getCell(i + 1);
      cell.value = c.h;
      cell.font = { name: 'Calibri', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + NAVY } };
      cell.alignment = { vertical: 'middle', horizontal: c.align || 'left', wrapText: true };
      cell.border = BORDERS;
    });
    hr.height = 30;
    rows.forEach((row, ri) => {
      const r = ws.getRow(startRow + 1 + ri);
      cols.forEach((c, i) => {
        const cell = r.getCell(i + 1);
        const v = row[c.key];
        if (v && typeof v === 'object' && v.hyperlink) {
          cell.value = { text: v.text, hyperlink: v.hyperlink };
          cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF2F5FB3' }, underline: true };
        } else {
          cell.value = v === undefined || v === null ? '' : v;
          cell.font = { name: 'Calibri', size: 10, bold: !!c.bold };
        }
        cell.alignment = { vertical: 'top', horizontal: c.align || 'left', wrapText: !!c.wrap };
        cell.border = BORDERS;
        if (c.numFmt) cell.numFmt = c.numFmt;
        const sw = c.status && STATUS_WARNA[v];
        if (sw) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + sw[1] } };
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF' + sw[0] } };
          cell.alignment = { vertical: 'top', horizontal: 'center' };
        } else if (opts.zebra !== false && ri % 2 === 1 && !(row._noZebra)) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F6F1' } };
        }
      });
    });
    ws.views = [{ state: 'frozen', ySplit: startRow, xSplit: opts.freezeCol || 0 }];
    if (rows.length) ws.autoFilter = { from: { row: startRow, column: 1 }, to: { row: startRow + rows.length, column: cols.length } };
    return startRow + rows.length;
  }

  async function unduhExcel(wb, nama) {
    const buf = await wb.xlsx.writeBuffer();
    simpan(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nama);
  }

  /* ================= PDF ================= */
  async function docBaru(orientasi) {
    const jsPDF = await libPdf();
    const doc = new jsPDF({ orientation: orientasi, unit: 'mm', format: 'a4' });
    doc.setProperties({ creator: 'Absensi VTEG' });
    return doc;
  }

  async function kopPdf(doc, meta, judul) {
    const lg = await logo();
    const W = doc.internal.pageSize.getWidth();
    let x = 12;
    if (lg.data) {
      const h = 16, w = h * lg.w / lg.h;
      doc.addImage(lg.data, 'PNG', 12, 9, w, h, 'logo', 'FAST');
      x = 12 + w + 5;
    }
    doc.setTextColor(...NAVY_RGB); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.text(judul, x, 14);
    doc.setTextColor(21, 24, 30); doc.setFontSize(10);
    doc.text(meta.instansi, x, 19.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(74, 80, 92);
    doc.text(`Periode: ${periodeTeks(meta)}${meta.filter ? '   ·   ' + meta.filter : ''}`, x, 24);
    doc.setDrawColor(...NAVY_RGB); doc.setLineWidth(0.6);
    doc.line(12, 29, W - 12, 29);
    return 34;
  }

  function footerPdf(doc, meta) {
    const n = doc.getNumberOfPages();
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(138, 144, 155);
      doc.text(`Dicetak ${dicetak()} · ${meta.instansi}`, 12, H - 7);
      doc.text(`Halaman ${i} dari ${n}`, W - 12, H - 7, { align: 'right' });
    }
  }

  function at(doc, opts) {
    const base = {
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.6, lineColor: [217, 214, 203], lineWidth: 0.15, textColor: [21, 24, 30], valign: 'top', overflow: 'linebreak' },
      headStyles: { fillColor: NAVY_RGB, textColor: 255, fontStyle: 'bold', valign: 'middle' },
      alternateRowStyles: { fillColor: [247, 246, 241] },
      margin: { left: 12, right: 12, top: 34, bottom: 14 }
    };
    const o = Object.assign({}, base, opts, {
      styles: Object.assign({}, base.styles, opts.styles),
      headStyles: Object.assign({}, base.headStyles, opts.headStyles)
    });
    if (typeof doc.autoTable === 'function') doc.autoTable(o); else window.autoTable(doc, o);
    return doc.lastAutoTable.finalY;
  }
  const warnaStatus = (data, kolom) => {
    if (data.section !== 'body' || data.column.dataKey !== kolom) return;
    const sw = STATUS_WARNA[data.cell.raw];
    if (sw) { data.cell.styles.textColor = hex2rgb(sw[0]); data.cell.styles.fillColor = hex2rgb(sw[1]); data.cell.styles.fontStyle = 'bold'; }
  };
  function subjudul(doc, y, teks) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(21, 24, 30);
    doc.text(teks, 12, y);
    return y + 3;
  }

  /* ================= DATA ABSENSI ================= */
  async function absensi(list, meta, format) {
    const rows = [...list].sort((a, b) => (a.tanggal + a.nama).localeCompare(b.tanggal + b.nama));
    const rekap = rekapAbsensi(rows);
    const nama = `absensi_${meta.dari}_sd_${meta.sampai}`;

    if (format === 'xlsx') {
      const ExcelJS = await libExcel();
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Absensi VTEG'; wb.created = new Date();

      const cols = [
        { key: 'no', h: 'No', w: 11, align: 'center' }, { key: 'tgl', h: 'Tanggal', w: 17 }, { key: 'id', h: 'ID', w: 9 },
        { key: 'nama', h: 'Nama', w: 24, bold: true }, { key: 'masuk', h: 'Masuk', w: 8, align: 'center' },
        { key: 'pulang', h: 'Pulang', w: 8, align: 'center' }, { key: 'durasi', h: 'Durasi', w: 9, align: 'center' },
        { key: 'status', h: 'Status', w: 12, status: true }, { key: 'telat', h: 'Telat (mnt)', w: 9, align: 'center' },
        { key: 'jarak', h: 'Jarak (m)', w: 9, align: 'center' }, { key: 'alamatM', h: 'Alamat Masuk', w: 36, wrap: true },
        { key: 'alamatP', h: 'Alamat Pulang', w: 36, wrap: true }, { key: 'peta', h: 'Peta', w: 9, align: 'center' },
        { key: 'fotoM', h: 'Foto Masuk', w: 10, align: 'center' }, { key: 'fotoP', h: 'Foto Pulang', w: 10, align: 'center' },
        { key: 'ket', h: 'Keterangan', w: 28, wrap: true }
      ];
      const ws = await sheetBaru(wb, 'Data Absensi', meta, 'Data Kehadiran Karyawan', cols);
      const data = rows.map((r, i) => ({
        no: i + 1, tgl: U.fmtTgl(r.tanggal), id: r.karyawanId, nama: r.nama,
        masuk: r.jamMasuk ? r.jamMasuk.slice(0, 5) : '', pulang: r.jamPulang ? r.jamPulang.slice(0, 5) : '',
        durasi: U.durasi(r.jamMasuk, r.jamPulang).replace('—', ''), status: r.status, telat: r.telat || '',
        jarak: r.jarak ? Number(r.jarak) : '', alamatM: r.alamatMasuk || '', alamatP: r.alamatPulang || '',
        peta: r.lokasiMasuk ? { text: 'Buka', hyperlink: mapsUrl(r.lokasiMasuk) } : '',
        fotoM: r.fotoMasuk ? { text: 'Lihat', hyperlink: fotoUrl(r.fotoMasuk) } : '',
        fotoP: r.fotoPulang ? { text: 'Lihat', hyperlink: fotoUrl(r.fotoPulang) } : '',
        ket: r.ket || ''
      }));
      tabelExcel(ws, 6, cols, data, { freezeCol: 4 });

      const rc = [
        { key: 'no', h: 'No', w: 11, align: 'center' }, { key: 'nama', h: 'Nama', w: 26, bold: true }, { key: 'id', h: 'ID', w: 9 },
        { key: 'hadir', h: 'Hadir', w: 8, align: 'center' }, { key: 'tepat', h: 'Tepat Waktu', w: 10, align: 'center' },
        { key: 'terlambat', h: 'Terlambat', w: 10, align: 'center' }, { key: 'telat', h: 'Total Telat', w: 11, align: 'center' },
        { key: 'pct', h: '% Tepat', w: 9, align: 'center' }, { key: 'rata', h: 'Rata-rata Kerja', w: 12, align: 'center' },
        { key: 'dinas', h: 'Dinas Luar', w: 9, align: 'center' }, { key: 'izin', h: 'Izin', w: 7, align: 'center' },
        { key: 'sakit', h: 'Sakit', w: 7, align: 'center' }, { key: 'cuti', h: 'Cuti', w: 7, align: 'center' }, { key: 'alpa', h: 'Alpa', w: 7, align: 'center' }
      ];
      const ws2 = await sheetBaru(wb, 'Rekap per Karyawan', meta, 'Rekap Kehadiran per Karyawan', rc);
      tabelExcel(ws2, 6, rc, rekap.map((x, i) => ({
        no: i + 1, nama: x.nama, id: x.id, hadir: x.hadir, tepat: x.tepat, terlambat: x.terlambat,
        telat: x.telat ? U.menit(x.telat) : '', pct: pctTepat(x), rata: x.nKerja ? U.menit(Math.round(x.kerja / x.nKerja)) : '',
        dinas: x.dinas, izin: x.izin, sakit: x.sakit, cuti: x.cuti, alpa: x.alpa
      })));
      return unduhExcel(wb, nama + '.xlsx');
    }

    // PDF
    const doc = await docBaru('landscape');
    const judul = 'Data Kehadiran Karyawan';
    const kop = () => kopPdf(doc, meta, judul);
    let y = await kop();
    const total = rows.length, nHadir = rows.filter(r => HADIR.includes(r.status)).length, nTelat = rows.filter(r => r.status === 'Terlambat').length;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(74, 80, 92);
    doc.text(`${total} catatan · ${nHadir} hadir · ${nTelat} terlambat · ${rekap.length} karyawan`, 12, y); y += 5;

    y = subjudul(doc, y, 'Rekap per Karyawan');
    const logoInfo = await logo();
    const gambarKop = () => { kopPdfSync(doc, meta, judul, logoInfo); };
    y = at(doc, {
      startY: y,
      head: [['No', 'Nama', 'ID', 'Hadir', 'Tepat', 'Terlambat', 'Total Telat', '% Tepat', 'Rata-rata Kerja', 'Dinas', 'Izin', 'Sakit', 'Cuti', 'Alpa']],
      body: rekap.map((x, i) => [i + 1, x.nama, x.id, x.hadir, x.tepat, x.terlambat, x.telat ? U.menit(x.telat) : '—', pctTepat(x),
        x.nKerja ? U.menit(Math.round(x.kerja / x.nKerja)) : '—', x.dinas, x.izin, x.sakit, x.cuti, x.alpa]),
      columnStyles: { 0: { halign: 'center', cellWidth: 9 }, 1: { fontStyle: 'bold' }, 3: { halign: 'center' }, 4: { halign: 'center' }, 5: { halign: 'center' },
        6: { halign: 'center' }, 7: { halign: 'center' }, 8: { halign: 'center' }, 9: { halign: 'center' }, 10: { halign: 'center' }, 11: { halign: 'center' }, 12: { halign: 'center' }, 13: { halign: 'center' } },
      didDrawPage: () => gambarKop()
    });

    y = subjudul(doc, y + 8, 'Detail Kehadiran');
    at(doc, {
      startY: y,
      head: [['No', 'Tanggal', 'Nama', 'Masuk', 'Pulang', 'Durasi', 'Status', 'Telat', 'Jarak', 'Alamat Masuk', 'Keterangan']],
      body: rows.map((r, i) => [i + 1, U.fmtTgl(r.tanggal), `${r.nama}\n${r.karyawanId}`, U.hm(r.jamMasuk), U.hm(r.jamPulang),
        U.durasi(r.jamMasuk, r.jamPulang), r.status, r.telat ? U.menit(r.telat) : '—', r.jarak ? r.jarak + ' m' : '—',
        r.alamatMasuk || '—', r.ket || '']),
      columns: ['no', 'tgl', 'nama', 'masuk', 'pulang', 'durasi', 'status', 'telat', 'jarak', 'alamat', 'ket'].map(k => ({ dataKey: k })),
      columnStyles: { no: { halign: 'center', cellWidth: 9 }, tgl: { cellWidth: 26 }, nama: { cellWidth: 38, fontStyle: 'bold' },
        masuk: { halign: 'center', cellWidth: 14 }, pulang: { halign: 'center', cellWidth: 14 }, durasi: { halign: 'center', cellWidth: 16 },
        status: { halign: 'center', cellWidth: 20 }, telat: { halign: 'center', cellWidth: 15 }, jarak: { halign: 'center', cellWidth: 15 },
        alamat: { fontSize: 7 }, ket: { cellWidth: 40 } },
      didParseCell: d => warnaStatus(d, 'status'),
      didDrawPage: () => gambarKop()
    });
    footerPdf(doc, meta);
    simpan(doc.output('blob'), nama + '.pdf');
  }

  // Versi sinkron kop (dipakai di halaman lanjutan tabel)
  function kopPdfSync(doc, meta, judul, lg) {
    const W = doc.internal.pageSize.getWidth();
    doc.setFillColor(255, 255, 255); doc.rect(0, 0, W, 31, 'F');
    let x = 12;
    if (lg && lg.data) { const h = 16, w = h * lg.w / lg.h; doc.addImage(lg.data, 'PNG', 12, 9, w, h, 'logo', 'FAST'); x = 12 + w + 5; }
    doc.setTextColor(...NAVY_RGB); doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text(judul, x, 14);
    doc.setTextColor(21, 24, 30); doc.setFontSize(10); doc.text(meta.instansi, x, 19.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(74, 80, 92);
    doc.text(`Periode: ${periodeTeks(meta)}${meta.filter ? '   ·   ' + meta.filter : ''}`, x, 24);
    doc.setDrawColor(...NAVY_RGB); doc.setLineWidth(0.6); doc.line(12, 29, W - 12, 29);
  }

  /* ================= LAPORAN KERJA ================= */
  async function laporan(list, meta, format) {
    const rows = [...list].sort((a, b) => (a.tanggal + a.nama).localeCompare(b.tanggal + b.nama));
    const rekap = rekapLaporan(rows);
    const nama = `laporan_kerja_${meta.dari}_sd_${meta.sampai}`;
    const ketItem = (it, l) => {
      if (!it.a || it.a >= l.tanggal) return '';
      return `Lanjutan · hari ke-${Lap.hariKe(it.a, l.tanggal)}`;
    };

    if (format === 'xlsx') {
      const ExcelJS = await libExcel();
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Absensi VTEG'; wb.created = new Date();
      const cols = [
        { key: 'tgl', h: 'Tanggal', w: 17 }, { key: 'id', h: 'ID', w: 9 }, { key: 'nama', h: 'Nama', w: 22, bold: true },
        { key: 'no', h: 'No', w: 5, align: 'center' }, { key: 'pek', h: 'Pekerjaan', w: 52, wrap: true },
        { key: 'status', h: 'Status', w: 11, status: true }, { key: 'mulai', h: 'Mulai', w: 15 },
        { key: 'hari', h: 'Hari ke-', w: 8, align: 'center' }, { key: 'cat', h: 'Catatan / Rencana', w: 40, wrap: true }
      ];
      const ws = await sheetBaru(wb, 'Laporan Kerja', meta, 'Laporan Kerja Harian', cols);
      const data = [], blok = [];
      rows.forEach((l, li) => {
        const items = l.items.length ? l.items : [{ t: '(tidak ada pekerjaan)', s: '' }];
        const start = data.length;
        items.forEach((it, i) => data.push({
          tgl: U.fmtTgl(l.tanggal), id: l.karyawanId, nama: l.nama, no: l.items.length ? i + 1 : '',
          pek: it.t, status: it.s, mulai: it.a ? U.fmtTgl(it.a) : (l.items.length ? U.fmtTgl(l.tanggal) : ''),
          hari: l.items.length ? Lap.hariKe(it.a || l.tanggal, l.tanggal) : '', cat: l.catatan || '', _blok: li
        }));
        blok.push([start, data.length - 1, li]);
      });
      const H0 = 6;
      tabelExcel(ws, H0, cols, data, { zebra: false, freezeCol: 3 });
      // gabung sel Tanggal/ID/Nama/Catatan per laporan + warna selang-seling per laporan
      blok.forEach(([a, b, li]) => {
        const r1 = H0 + 1 + a, r2 = H0 + 1 + b;
        if (li % 2 === 1) {
          for (let r = r1; r <= r2; r++) cols.forEach((c, ci) => {
            const cell = ws.getRow(r).getCell(ci + 1);
            if (!(c.status && STATUS_WARNA[cell.value])) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F6F1' } };
          });
        }
        if (r2 > r1) [1, 2, 3, 9].forEach(ci => ws.mergeCells(r1, ci, r2, ci));
        [1, 2, 3, 9].forEach(ci => { ws.getRow(r1).getCell(ci).alignment = { vertical: 'top', wrapText: ci === 9 }; });
      });

      const rc = [
        { key: 'no', h: 'No', w: 11, align: 'center' }, { key: 'nama', h: 'Nama', w: 26, bold: true }, { key: 'id', h: 'ID', w: 9 },
        { key: 'laporan', h: 'Jumlah Laporan', w: 11, align: 'center' }, { key: 'item', h: 'Pekerjaan', w: 10, align: 'center' },
        { key: 'selesai', h: 'Selesai', w: 9, align: 'center' }, { key: 'proses', h: 'Proses', w: 9, align: 'center' },
        { key: 'kendala', h: 'Kendala', w: 9, align: 'center' }, { key: 'lanjut', h: 'Lanjutan Belum Selesai', w: 13, align: 'center' }
      ];
      const ws2 = await sheetBaru(wb, 'Ringkasan', meta, 'Ringkasan Laporan Kerja', rc, 'portrait');
      tabelExcel(ws2, 6, rc, rekap.map((x, i) => ({ no: i + 1, ...x })));
      return unduhExcel(wb, nama + '.xlsx');
    }

    // PDF
    const doc = await docBaru('portrait');
    const judul = 'Laporan Kerja Harian';
    const lg = await logo();
    let y = await kopPdf(doc, meta, judul);
    const nItem = rows.reduce((a, l) => a + l.items.length, 0);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(74, 80, 92);
    doc.text(`${rows.length} laporan · ${nItem} pekerjaan · ${rekap.length} karyawan`, 12, y); y += 5;

    y = subjudul(doc, y, 'Ringkasan per Karyawan');
    y = at(doc, {
      startY: y,
      head: [['No', 'Nama', 'ID', 'Laporan', 'Pekerjaan', 'Selesai', 'Proses', 'Kendala', 'Lanjutan']],
      body: rekap.map((x, i) => [i + 1, x.nama, x.id, x.laporan, x.item, x.selesai, x.proses, x.kendala, x.lanjut]),
      columnStyles: { 0: { halign: 'center', cellWidth: 9 }, 1: { fontStyle: 'bold' }, 3: { halign: 'center' }, 4: { halign: 'center' },
        5: { halign: 'center' }, 6: { halign: 'center' }, 7: { halign: 'center' }, 8: { halign: 'center' } },
      didDrawPage: () => kopPdfSync(doc, meta, judul, lg)
    });

    y = subjudul(doc, y + 8, 'Detail Laporan');
    const body = [];
    rows.forEach(l => {
      const items = l.items.length ? l.items : [{ t: '(tidak ada pekerjaan)', s: '' }];
      const span = items.length + (l.catatan ? 1 : 0);
      items.forEach((it, i) => {
        const row = [];
        if (i === 0) {
          row.push({ content: U.fmtTgl(l.tanggal), rowSpan: span, styles: { fillColor: [255, 255, 255] } });
          row.push({ content: `${l.nama}\n${l.karyawanId}`, rowSpan: span, styles: { fontStyle: 'bold', fillColor: [255, 255, 255] } });
        }
        row.push(l.items.length ? i + 1 : '', it.t, it.s, ketItem(it, l));
        body.push(row);
      });
      if (l.catatan) body.push([{ content: 'Catatan / rencana: ' + l.catatan, colSpan: 4, styles: { fontStyle: 'italic', textColor: [74, 80, 92], fillColor: [246, 245, 240] } }]);
    });
    at(doc, {
      startY: y,
      head: [['Tanggal', 'Karyawan', 'No', 'Pekerjaan', 'Status', 'Keterangan']],
      body,
      alternateRowStyles: {},
      columns: ['tgl', 'kar', 'no', 'pek', 'status', 'ket'].map(k => ({ dataKey: k })),
      columnStyles: { tgl: { cellWidth: 25 }, kar: { cellWidth: 34 }, no: { halign: 'center', cellWidth: 8 },
        status: { halign: 'center', cellWidth: 18 }, ket: { cellWidth: 30, fontSize: 7, textColor: [180, 83, 11] } },
      didParseCell: d => warnaStatus(d, 'status'),
      didDrawPage: () => kopPdfSync(doc, meta, judul, lg)
    });
    footerPdf(doc, meta);
    simpan(doc.output('blob'), nama + '.pdf');
  }

  return { absensi, laporan };
})();
