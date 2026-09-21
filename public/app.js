(function () {
'use strict';
var KEYS = ['meta', 'google'];
var P = { meta: { name: 'Instagram', color: 'var(--ig)' }, google: { name: 'Google', color: 'var(--gg)' }, ga4: { name: 'Analytics', color: 'var(--ga)' } };
var ALL_SOURCES = ['meta', 'google', 'ga4'];
var S = { me: null, cfg: null, rows: [], ga: [], gaScope: 'all', from: '', to: '', plat: 'all', q: '', sort: 's', dir: -1, metric: 's', cur: 'RSD' };
var TR = null;
var $ = function (id) { return document.getElementById(id); };

/* ---------- formatting ---------- */
var nfCache = {};
function nf(d) { d = d || 0; if (!nfCache[d]) nfCache[d] = new Intl.NumberFormat('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }); return nfCache[d]; }
function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function money(v, d) { return v == null ? '–' : nf(d || 0).format(v) + ' ' + S.cur; }
function int(v) { return v == null ? '–' : nf(0).format(Math.round(v)); }
function pct(v) { return v == null ? '–' : nf(2).format(v * 100) + '%'; }
function roas(v) { return v == null ? '–' : nf(2).format(v) + 'x'; }
function compact(v) { if (v >= 1e6) return nf(1).format(v / 1e6) + ' M'; if (v >= 1e3) return nf(v >= 1e4 ? 0 : 1).format(v / 1e3) + ' k'; return nf(0).format(v); }
function fdate(d, year) { var p = d.split('-'); return +p[2] + '.' + +p[1] + '.' + (year ? p[0] : ''); }
function fdt(s) { try { return new Date(s).toLocaleString('de-DE', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return s; } }
function localISO(d) { var m = d.getMonth() + 1, day = d.getDate(); return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day; }
function toast(msg) { var t = $('toast'); t.textContent = msg; t.className = 'on'; clearTimeout(toast.t); toast.t = setTimeout(function () { t.className = ''; }, 3500); }

/* ---------- api ---------- */
function api(path, opts) {
  opts = opts || {};
  opts.credentials = 'same-origin';
  opts.headers = { 'Content-Type': 'application/json' };
  return fetch(path, opts).then(function (r) {
    return r.json().catch(function () { return null; }).then(function (j) {
      if (r.status === 401 && path !== '/api/login') { showLogin(); throw new Error('Sesija je istekla. Prijavite se ponovo.'); }
      if (!r.ok) throw new Error((j && j.error) || ('Greška ' + r.status));
      return j;
    });
  });
}

/* ---------- login / session ---------- */
function showLogin() { S.me = null; $('app').hidden = true; $('login').hidden = false; }
function enterApp() {
  $('login').hidden = true; $('app').hidden = false;
  document.body.classList.toggle('is-admin', S.me.role === 'admin');
  $('who').textContent = S.me.email;
  $('usersPanel').hidden = S.me.role !== 'admin';
  if (S.me.role === 'admin') loadUsers();
  loadConfig().then(function () { setPreset(30); }).catch(function (e) { toast(e.message); });
}
function loadConfig() {
  return api('/api/config').then(function (c) { S.cfg = c; S.cur = c.currency || 'RSD'; renderSources(); });
}

/* ---------- data ---------- */
function setPreset(n) {
  var now = new Date();
  S.to = localISO(now);
  S.from = localISO(new Date(now.getTime() - (n - 1) * 86400000));
  $('from').value = S.from; $('to').value = S.to;
  markPreset(n);
  loadRows();
}
function markPreset(n) {
  document.querySelectorAll('#presets button').forEach(function (b) { b.setAttribute('aria-pressed', String(+b.getAttribute('data-days') === n)); });
}
function loadRows() {
  if (!S.from || !S.to || S.to < S.from) { toast('Datum "Do" ne može biti pre datuma "Od".'); return Promise.resolve(); }
  var qs = '?from=' + S.from + '&to=' + S.to;
  return Promise.all([api('/api/rows' + qs), api('/api/ga' + qs)]).then(function (res) { S.rows = res[0]; S.ga = res[1]; render(); })
    .catch(function (e) { toast(e.message); });
}
function filtered() {
  var q = S.q;
  return S.rows.filter(function (r) {
    if (S.plat !== 'all' && r.p !== S.plat) return false;
    if (q && r.c.toLowerCase().indexOf(q) < 0) return false;
    return true;
  }).map(function (r) { return { p: r.p, c: r.c, d: r.d, s: r.s, i: r.i, k: r.k, v: r.v, r: r.r }; });
}
function Z() { return { s: 0, i: 0, k: 0, v: 0, r: 0 }; }
function add(a, r) { a.s += r.s; a.i += r.i; a.k += r.k; a.v += r.v; a.r += r.r; }
function der(t) {
  return { s: t.s, i: t.i, k: t.k, v: t.v, r: t.r, ctr: t.i ? t.k / t.i : null, cpc: t.k ? t.s / t.k : null, cpa: t.v ? t.s / t.v : null, roas: (t.r && t.s) ? t.r / t.s : null };
}

/* ---------- CSV import (rezerva dok API nije podešen) ---------- */
function decode(buf) {
  var b = new Uint8Array(buf), enc = 'utf-8', txt;
  if (b[0] === 0xFF && b[1] === 0xFE) enc = 'utf-16le'; else if (b[0] === 0xFE && b[1] === 0xFF) enc = 'utf-16be';
  try { txt = new TextDecoder(enc, { fatal: true }).decode(buf); }
  catch (e) { try { txt = new TextDecoder('windows-1250').decode(buf); } catch (e2) { txt = new TextDecoder('utf-8').decode(buf); } }
  return txt.replace(/^\ufeff/, '');
}
function detectDelim(t) {
  var lines = t.split(/\r?\n/).filter(Boolean).slice(0, 12), best = ',', max = -1;
  [',', ';', '\t'].forEach(function (d) { var n = 0; lines.forEach(function (l) { n += l.split(d).length - 1; }); if (n > max) { max = n; best = d; } });
  return best;
}
function parseCSV(t, d) {
  var rows = [], row = [], cur = '', q = false, i, c;
  for (i = 0; i < t.length; i++) {
    c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === d) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(function (r) { return r.some(function (x) { return x.trim() !== ''; }); });
}
function num(s, isInt) {
  if (s == null) return 0;
  s = String(s).trim();
  if (!s || /^-+$/.test(s)) return 0;
  s = s.replace(/[^\d.,\-]/g, '');
  if (!s) return 0;
  var c = s.lastIndexOf(','), d = s.lastIndexOf('.');
  if (c > -1 && d > -1) { s = c > d ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, ''); }
  else if (c > -1) { s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.'); }
  else if (d > -1) { if ((s.match(/\./g) || []).length > 1 || (isInt && /^-?\d{1,3}\.\d{3}$/.test(s))) s = s.replace(/\./g, ''); }
  var v = parseFloat(s); return isFinite(v) ? v : 0;
}
function pad(n) { n = String(n); return n.length < 2 ? '0' + n : n; }
function iso(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
function pdate(s) {
  s = (s || '').trim(); if (!s) return '';
  var m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return iso(m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})([./])(\d{1,2})\2(\d{4})/))) {
    var a = +m[1], b = +m[3];
    if (m[2] === '/' && a <= 12 && b > 12) return iso(m[4], a, b);
    return iso(m[4], b, a);
  }
  var t = Date.parse(s);
  if (!isNaN(t)) { var dt = new Date(t); return iso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate()); }
  return '';
}
var ALIASES = {
  date: ['day', 'date', 'dan', 'datum', 'reporting starts', 'date start'],
  campaign: ['campaign name', 'campaign', 'kampanja', 'naziv kampanje', 'ime kampanje'],
  plat: ['platform', 'platforma'],
  spend: ['amount spent', 'cost', 'spend', 'cena', 'trošak', 'trosak', 'potrošeno', 'potroseno'],
  impr: ['impressions', 'impr.', 'impr', 'prikazi', 'prikazivanja', 'impresije'],
  clicks: ['clicks', 'link clicks', 'klikovi', 'kliks'],
  conv: ['conversions', 'results', 'konverzije', 'rezultati', 'purchases', 'kupovine'],
  rev: ['conv. value', 'conversion value', 'purchases conversion value', 'purchase conversion value', 'all conv. value', 'vrednost konverzije', 'revenue', 'prihod']
};
function normH(h) { return String(h).replace(/\ufeff/g, '').toLowerCase().replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim(); }
function mapHeaders(row) {
  var n = row.map(normH), map = {};
  Object.keys(ALIASES).forEach(function (k) {
    map[k] = -1;
    for (var i = 0; i < ALIASES[k].length; i++) { var ix = n.indexOf(ALIASES[k][i]); if (ix > -1) { map[k] = ix; break; } }
  });
  return map;
}
function buildRows(key, data) {
  var h = -1, map = null, i;
  for (i = 0; i < Math.min(10, data.length); i++) {
    var m = mapHeaders(data[i]);
    if (m.campaign > -1 && (m.spend > -1 || m.clicks > -1 || m.impr > -1)) { h = i; map = m; break; }
  }
  if (h < 0) return { error: 'Nisam pronašao kolone. Potrebni su bar naziv kampanje i potrošnja (ili klikovi).' };
  if (map.date < 0) return { error: 'Izvoz mora sadržati kolonu sa datumom (Dan). U Meta Ads Manageru raščlanite po danu, a u Google Ads-u dodajte segment Vreme, pa Dan.' };
  var rows = [], skipped = 0;
  for (i = h + 1; i < data.length; i++) {
    var r = data[i], name = (r[map.campaign] || '').trim();
    if (!name || name === '--' || /^(total|ukupno)\b/i.test(name)) continue;
    if (key === 'meta' && map.plat > -1) {
      var p = (r[map.plat] || '').toLowerCase();
      if (p && p.indexOf('instagram') < 0) { skipped++; continue; }
    }
    var d = pdate(r[map.date]);
    if (!d) continue;
    rows.push({ c: name, d: d, s: num(r[map.spend]), i: num(r[map.impr], 1), k: num(r[map.clicks], 1), v: num(r[map.conv]), r: num(r[map.rev]) });
  }
  if (!rows.length) return { error: 'Fajl ne sadrži nijedan red sa kampanjom i datumom.' };
  return { rows: rows, skipped: skipped };
}
function importFile(key, file) {
  var fr = new FileReader();
  fr.onerror = function () { toast('Fajl nije moguće pročitati.'); };
  fr.onload = function () {
    var res;
    try { var text = decode(fr.result); res = buildRows(key, parseCSV(text, detectDelim(text))); }
    catch (e) { toast('Greška pri čitanju fajla.'); return; }
    if (res.error) { toast(res.error); return; }
    if (res.rows.length > 30000) { toast('Izvoz ima previše redova (najviše 30.000). Izvezite kraći period.'); return; }
    api('/api/import/' + key, { method: 'POST', body: JSON.stringify({ rows: res.rows }) })
      .then(function (out) { toast('Uvezeno: ' + out.imported + ' redova (' + fdate(out.from, 1) + ' do ' + fdate(out.to, 1) + ').'); return loadConfig().then(loadRows); })
      .catch(function (e) { toast(e.message); });
  };
  fr.readAsArrayBuffer(file);
}

/* ---------- render ---------- */
function renderSources() {
  if (!S.cfg) return;
  ALL_SOURCES.forEach(function (key) {
    var c = S.cfg.platforms[key], el = document.querySelector('.source[data-key="' + key + '"]');
    if (!el || !c) return;
    var st = el.querySelector('[data-status]'), meta = el.querySelector('[data-meta]'), rm = el.querySelector('[data-remove]');
    var n = key === 'ga4' ? S.ga.length : S.rows.filter(function (r) { return r.p === key; }).length, cls = 'status', txt;
    if (c.configured) {
      if (!c.last) txt = 'Povezano. Još nije osvežavano.';
      else if (c.last.ok) { txt = 'Povezano. Poslednje osvežavanje: ' + fdt(c.last.finished_at); cls += ' ok'; }
      else { txt = 'Poslednje osvežavanje nije uspelo: ' + (c.last.message || 'nepoznata greška'); cls += ' err'; }
    } else txt = 'API nije podešen na serveru.';
    st.textContent = txt; st.className = cls;
    meta.textContent = n + ' redova u izabranom periodu' + (c.csvRows ? ', ' + c.csvRows + ' uvezeno iz CSV-a' : '');
    if (rm) rm.hidden = !c.csvRows;
  });
}
function bandHTML(rows) {
  var tot = Z(), by = { meta: Z(), google: Z() }, present = {};
  rows.forEach(function (r) { add(tot, r); add(by[r.p], r); present[r.p] = 1; });
  var T = der(tot), rev = tot.r > 0;
  var M = [['Potrošnja', function (t) { return money(t.s); }], ['Prikazi', function (t) { return int(t.i); }], ['Klikovi', function (t) { return int(t.k); }], ['CTR', function (t) { return pct(t.ctr); }],
    ['CPC', function (t) { return money(t.cpc, 2); }], ['Konverzije', function (t) { return int(t.v); }], ['CPA', function (t) { return money(t.cpa, 2); }]];
  if (rev) M.push(['ROAS', function (t) { return roas(t.roas); }]);
  return M.map(function (m) {
    var lines = KEYS.filter(function (k) { return present[k]; }).map(function (k) {
      return '<div class="kpi-p"><span class="dot" style="background:' + P[k].color + '"></span>' + P[k].name + ' ' + m[1](der(by[k])) + '</div>';
    }).join('');
    return '<div class="kpi"><div class="kpi-l">' + m[0] + '</div><div class="kpi-v">' + m[1](T) + '</div>' + lines + '</div>';
  }).join('');
}
function niceMax(v) { if (v <= 0) return 1; var p = Math.pow(10, Math.floor(Math.log(v) / Math.LN10)), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
function trendHTML(rows) {
  var key = S.metric;
  var head = '<div class="panel-head"><h2>Kretanje po danima</h2><div class="seg" role="group" aria-label="Metrika">' +
    [['s', 'Potrošnja'], ['k', 'Klikovi'], ['v', 'Konverzije']].map(function (x) { return '<button type="button" data-metric="' + x[0] + '" aria-pressed="' + (S.metric === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div></div>';
  var seen = {}; rows.forEach(function (r) { if (r.d) seen[r.d] = 1; });
  var dates = Object.keys(seen).sort();
  if (dates.length < 2) { TR = null; return head + '<p class="hint pad">Za grafikon je potrebno bar dva dana podataka.</p>'; }
  var idx = {}; dates.forEach(function (d, i) { idx[d] = i; });
  var ser = {}, mx = 0;
  KEYS.forEach(function (p) {
    var arr = dates.map(function () { return 0; }), any = false;
    rows.forEach(function (r) { if (r.p === p && r.d) { arr[idx[r.d]] += r[key]; any = true; } });
    if (any) { ser[p] = arr; arr.forEach(function (v) { if (v > mx) mx = v; }); }
  });
  var W = 720, H = 240, pl = 52, pr = 12, pt = 12, pb = 28, pw = W - pl - pr, ph = H - pt - pb, top = niceMax(mx), n = dates.length;
  function X(i) { return pl + pw * i / (n - 1); }
  function Y(v) { return pt + ph - ph * v / top; }
  var g = '', t;
  for (t = 0; t <= 4; t++) {
    var yv = top * t / 4, y = Y(yv);
    g += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y + '" y2="' + y + '" stroke="var(--line)"/><text x="' + (pl - 8) + '" y="' + (y + 4) + '" text-anchor="end">' + compact(yv) + '</text>';
  }
  [0, Math.floor((n - 1) / 2), n - 1].forEach(function (i, j) {
    g += '<text x="' + X(i) + '" y="' + (H - 8) + '" text-anchor="' + (j === 0 ? 'start' : j === 2 ? 'end' : 'middle') + '">' + fdate(dates[i]) + '</text>';
  });
  Object.keys(ser).forEach(function (p) {
    var d = ser[p].map(function (v, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); }).join(' ');
    g += '<path d="' + d + '" fill="none" stroke="' + P[p].color + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
  });
  g += '<line id="guide" y1="' + pt + '" y2="' + (pt + ph) + '" stroke="var(--muted)" stroke-dasharray="3 3" visibility="hidden"/>';
  TR = { dates: dates, ser: ser, W: W, pl: pl, pw: pw, n: n, X: X, key: key };
  var legend = '<div class="legend">' + Object.keys(ser).map(function (p) { return '<span><span class="dot" style="background:' + P[p].color + '"></span>' + P[p].name + '</span>'; }).join('') + '</div>';
  return head + '<div class="readout" id="readout">Pređite preko grafikona za vrednosti po danu.</div><svg class="chart" id="tsvg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Grafikon kretanja po danima">' + g + '</svg>' + legend;
}
function bindTrend() {
  var svg = $('tsvg'); if (!svg || !TR) return;
  var guide = $('guide'), out = $('readout');
  function move(e) {
    var r = svg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * TR.W;
    var i = Math.round((x - TR.pl) / TR.pw * (TR.n - 1)); i = Math.max(0, Math.min(TR.n - 1, i));
    guide.setAttribute('x1', TR.X(i)); guide.setAttribute('x2', TR.X(i)); guide.setAttribute('visibility', 'visible');
    var f = TR.key === 's' ? function (v) { return money(v); } : int;
    out.textContent = fdate(TR.dates[i], 1) + ': ' + Object.keys(TR.ser).map(function (p) { return P[p].name + ' ' + f(TR.ser[p][i]); }).join(', ');
  }
  svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', function () { guide.setAttribute('visibility', 'hidden'); });
}
function shareHTML(rows) {
  var by = { meta: Z(), google: Z() }; rows.forEach(function (r) { add(by[r.p], r); });
  var items = [['Potrošnja', 's', function (v) { return money(v); }], ['Klikovi', 'k', int], ['Konverzije', 'v', int]];
  var html = '<div class="panel-head"><h2>Instagram i Google</h2></div>', any = false;
  items.forEach(function (it) {
    var a = by.meta[it[1]], b = by.google[it[1]], tot = a + b;
    if (!tot) return;
    any = true;
    var pa = Math.round(a / tot * 100), pb = 100 - pa;
    html += '<div class="share"><div class="share-h"><span>' + it[0] + '</span><b>' + it[2](tot) + '</b></div>' +
      '<div class="bar" role="img" aria-label="Instagram ' + pa + '%, Google ' + pb + '%"><span style="width:' + pa + '%;background:var(--ig)"></span><span style="width:' + pb + '%;background:var(--gg)"></span></div>' +
      '<div class="share-f"><span>Instagram ' + pa + '% (' + it[2](a) + ')</span><span>Google ' + pb + '% (' + it[2](b) + ')</span></div></div>';
  });
  if (!any) html += '<p class="hint pad">Nema podataka za izabrane filtere.</p>';
  return html;
}
var COLS = [['c', 'Kampanja'], ['p', 'Platforma'], ['s', 'Potrošnja'], ['i', 'Prikazi'], ['k', 'Klikovi'], ['ctr', 'CTR'], ['cpc', 'CPC'], ['v', 'Konverzije'], ['cpa', 'CPA'], ['r', 'Prihod'], ['roas', 'ROAS']];
function campaigns(rows) {
  var map = {};
  rows.forEach(function (r) { var id = r.p + '|' + r.c; if (!map[id]) { map[id] = Z(); map[id].c = r.c; map[id].p = r.p; } add(map[id], r); });
  return Object.keys(map).map(function (id) { var t = map[id], d = der(t); d.c = t.c; d.p = t.p; return d; });
}
function cell(col, d) {
  switch (col) {
    case 'c': return esc(d.c);
    case 'p': return '<span class="pl"><span class="dot" style="background:' + P[d.p].color + '"></span>' + P[d.p].name + '</span>';
    case 's': return money(d.s); case 'i': return int(d.i); case 'k': return int(d.k); case 'ctr': return pct(d.ctr);
    case 'cpc': return money(d.cpc, 2); case 'v': return int(d.v); case 'cpa': return money(d.cpa, 2);
    case 'r': return d.r ? money(d.r) : '–'; case 'roas': return roas(d.roas);
  }
  return '';
}
function visibleCols(rows) { var rev = rows.some(function (r) { return r.r > 0; }); return COLS.filter(function (c) { return rev || (c[0] !== 'r' && c[0] !== 'roas'); }); }
function tableHTML(rows) {
  var cols = visibleCols(rows), list = campaigns(rows);
  list.sort(function (a, b) {
    var x = a[S.sort], y = b[S.sort];
    if (typeof x === 'string') return S.dir * x.localeCompare(y);
    if (x == null) x = -Infinity; if (y == null) y = -Infinity;
    return S.dir * (x - y);
  });
  var tot = Z(); rows.forEach(function (r) { add(tot, r); }); var T = der(tot); T.c = 'Ukupno'; T.p = '';
  var h = '<table><thead><tr>' + cols.map(function (c) {
    var cur = S.sort === c[0];
    return '<th aria-sort="' + (cur ? (S.dir < 0 ? 'descending' : 'ascending') : 'none') + '"><button type="button" data-sort="' + c[0] + '">' + c[1] + (cur ? (S.dir < 0 ? ' ↓' : ' ↑') : '') + '</button></th>';
  }).join('') + '</tr></thead><tbody>';
  if (!list.length) h += '<tr><td class="none" colspan="' + cols.length + '">Nijedna kampanja ne odgovara izabranim filterima.</td></tr>';
  list.forEach(function (d) { h += '<tr>' + cols.map(function (c) { return '<td>' + cell(c[0], d) + '</td>'; }).join('') + '</tr>'; });
  h += '</tbody><tfoot><tr>' + cols.map(function (c) { return '<td>' + (c[0] === 'p' ? '' : cell(c[0], T)) + '</td>'; }).join('') + '</tr></tfoot></table>';
  return h;
}
/* ---------- Google Analytics ---------- */
var PAID = /cpc|ppc|cpm|paid|display|retarget|remarket/i;
function srcClass(s) {
  s = (s || '').toLowerCase();
  if (/google/.test(s)) return 'google';
  if (/^(instagram|ig|facebook|fb|meta)([\W_]|$)/.test(s)) return 'meta';
  return '';
}
function normName(s) {
  return String(s || '').replace(/đ/gi, 'dj').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}
function gaRows() { return S.gaScope === 'paid' ? S.ga.filter(function (r) { return PAID.test(r.med); }) : S.ga; }
function gaBandHTML(rows) {
  var t = { ss: 0, es: 0, ke: 0, r: 0 };
  rows.forEach(function (r) { t.ss += r.ss; t.es += r.es; t.ke += r.ke; t.r += r.r; });
  var M = [['Sesije', int(t.ss)], ['Angažovane sesije', int(t.es)], ['Stopa angažovanja', pct(t.ss ? t.es / t.ss : null)],
    ['Ključni događaji', int(t.ke)], ['Ključnih događaja po sesiji', pct(t.ss ? t.ke / t.ss : null)]];
  if (t.r > 0) M.push(['Prihod', money(t.r)]);
  return M.map(function (m) { return '<div class="kpi"><div class="kpi-l">' + m[0] + '</div><div class="kpi-v">' + m[1] + '</div></div>'; }).join('');
}
function gaTableHTML(rows) {
  var map = {};
  rows.forEach(function (r) {
    var k = r.src + ' / ' + r.med;
    if (!map[k]) map[k] = { n: k, ss: 0, es: 0, ke: 0, r: 0 };
    map[k].ss += r.ss; map[k].es += r.es; map[k].ke += r.ke; map[k].r += r.r;
  });
  var list = Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return b.ss - a.ss; });
  var tot = { ss: 0, es: 0, ke: 0, r: 0 }; list.forEach(function (x) { tot.ss += x.ss; tot.es += x.es; tot.ke += x.ke; tot.r += x.r; });
  var rev = tot.r > 0, shown = list.slice(0, 25);
  var heads = ['Izvor / medijum', 'Sesije', 'Angažovane', 'Stopa angažovanja', 'Ključni događaji', 'Po sesiji'].concat(rev ? ['Prihod'] : []);
  function tr(x, b) {
    var cells = [b ? x.n : esc(x.n), int(x.ss), int(x.es), pct(x.ss ? x.es / x.ss : null), int(x.ke), pct(x.ss ? x.ke / x.ss : null)].concat(rev ? [x.r ? money(x.r) : '–'] : []);
    return '<tr>' + cells.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
  }
  var h = '<table class="t-ga"><thead><tr>' + heads.map(function (x) { return '<th><span class="th">' + x + '</span></th>'; }).join('') + '</tr></thead><tbody>';
  shown.forEach(function (x) { h += tr(x); });
  h += '</tbody><tfoot>' + tr({ n: list.length > shown.length ? 'Ukupno (svi izvori)' : 'Ukupno', ss: tot.ss, es: tot.es, ke: tot.ke, r: tot.r }, true) + '</tfoot></table>';
  if (list.length > shown.length) h += '<p class="hint pad-s">Prikazano prvih 25 od ' + list.length + ' izvora.</p>';
  return h;
}
function joinHTML() {
  var toAd = function (r) { return r; };
  var allAds = campaigns(S.rows.map(toAd));
  var ga = {};
  S.ga.forEach(function (r) {
    var pf = srcClass(r.src), nm = normName(r.c);
    if (!pf || !nm || nm === 'notset') return;
    var k = pf + '|' + nm;
    if (!ga[k]) ga[k] = { ss: 0, es: 0, ke: 0, r: 0 };
    ga[k].ss += r.ss; ga[k].es += r.es; ga[k].ke += r.ke; ga[k].r += r.r;
  });
  var used = {};
  allAds.forEach(function (d) { var k = d.p + '|' + normName(d.c); if (ga[k]) used[k] = true; });

  var list = campaigns(filtered()).sort(function (a, b) { return b.s - a.s; });
  var matched = 0, anyRev = false;
  var rows = list.map(function (d) {
    var k = d.p + '|' + normName(d.c), g = ga[k] || null;
    if (g) { matched++; if (g.r > 0) anyRev = true; }
    return { d: d, g: g };
  });
  var heads = ['Kampanja', 'Platforma', 'Klikovi (oglas)', 'Sesije (GA4)', 'Sesije po kliku', 'Konverzije (oglas)', 'Ključni događaji (GA4)', 'Cena po ključnom događaju'].concat(anyRev ? ['Prihod (GA4)', 'ROAS (GA4)'] : []);
  var h = '<table class="t-join"><thead><tr>' + heads.map(function (x) { return '<th><span class="th">' + x + '</span></th>'; }).join('') + '</tr></thead><tbody>';
  if (!rows.length) h += '<tr><td class="none" colspan="' + heads.length + '">Nijedna kampanja ne odgovara izabranim filterima.</td></tr>';
  rows.forEach(function (x) {
    var d = x.d, g = x.g, dash = '–';
    var cells = [esc(d.c), cell('p', d), int(d.k), g ? int(g.ss) : dash, g && d.k ? pct(g.ss / d.k) : dash, int(d.v),
      g ? int(g.ke) : dash, g && g.ke ? money(d.s / g.ke, 2) : dash];
    if (anyRev) cells.push(g && g.r ? money(g.r) : dash, g && g.r && d.s ? roas(g.r / d.s) : dash);
    h += '<tr>' + cells.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
  });
  h += '</tbody></table>';

  // Plaćene sesije koje nisu povezane ni sa jednom kampanjom (najčešće fale UTM parametri ili se nazivi razlikuju).
  var loose = {}, looseTotal = 0;
  S.ga.forEach(function (r) {
    if (!PAID.test(r.med)) return;
    var pf = srcClass(r.src), k = pf + '|' + normName(r.c);
    if (pf && used[k]) return;
    loose[r.c] = (loose[r.c] || 0) + r.ss; looseTotal += r.ss;
  });
  var note = 'Povezano ' + matched + ' od ' + rows.length + ' kampanja.';
  if (looseTotal > 0) {
    var top = Object.keys(loose).sort(function (a, b) { return loose[b] - loose[a]; }).slice(0, 3).map(function (n) { return '"' + esc(n) + '"'; }).join(', ');
    note += ' Plaćenih sesija bez povezane kampanje: ' + int(looseTotal) + ' (npr. ' + top + '). Proverite da se utm_campaign poklapa sa nazivom kampanje u oglasnom nalogu.';
  }
  return { html: h, note: note };
}
function renderGa() {
  var rows = gaRows();
  $('gaBand').innerHTML = gaBandHTML(rows);
  $('gaTable').innerHTML = gaTableHTML(rows);
  var hasAds = S.rows.length > 0;
  $('joinPanel').hidden = !hasAds;
  if (hasAds) { var j = joinHTML(); $('joinTable').innerHTML = j.html; $('joinNote').textContent = j.note; }
}

function render() {
  renderSources();
  var hasAds = S.rows.length > 0, hasGa = S.ga.length > 0;
  $('empty').hidden = hasAds || hasGa; $('report').hidden = !hasAds; $('gaReport').hidden = !hasGa;
  if (!hasAds && !hasGa) {
    var conf = S.cfg && ALL_SOURCES.some(function (k) { return S.cfg.platforms[k] && S.cfg.platforms[k].configured; });
    $('emptyText').textContent = conf
      ? 'Izaberite drugi period ili osvežite podatke. Ako je API tek podešen, prvo osvežavanje traje nekoliko minuta.'
      : 'API-ji još nisu podešeni na serveru. Administrator može da uveze CSV izvoz iz Meta Ads Managera i Google Ads-a dok se povezivanje ne završi.';
    return;
  }
  if (hasAds) {
    var rows = filtered();
    $('band').innerHTML = bandHTML(rows);
    $('trend').innerHTML = trendHTML(rows); bindTrend();
    $('share').innerHTML = shareHTML(rows);
    $('table').innerHTML = tableHTML(rows);
  }
  if (hasGa) renderGa();
}

/* ---------- korisnici (samo administrator) ---------- */
function loadUsers() {
  return api('/api/users').then(function (list) {
    $('usersTable').innerHTML = '<table class="t-users"><thead><tr><th><span class="th">Email</span></th><th><span class="th">Uloga</span></th><th><span class="th"></span></th></tr></thead><tbody>' +
      list.map(function (u) {
        var self = S.me && u.email === S.me.email;
        return '<tr><td>' + esc(u.email) + (self ? ' (vi)' : '') + '</td><td>' + (u.role === 'admin' ? 'Administrator' : 'Pregled') + '</td><td>' +
          (self ? '' : '<button class="link" type="button" data-del="' + u.id + '">Obriši</button>') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }).catch(function (e) { toast(e.message); });
}

/* ---------- copy ---------- */
function copyTable() {
  var rows = filtered(), cols = visibleCols(rows), list = campaigns(rows);
  var plain = function (col, d) { var v = cell(col, d); return col === 'p' ? P[d.p].name : v.replace(/<[^>]+>/g, ''); };
  var tsv = [cols.map(function (c) { return c[1]; }).join('\t')].concat(list.map(function (d) { return cols.map(function (c) { return plain(c[0], d); }).join('\t'); })).join('\n');
  function fallback() {
    var ta = document.createElement('textarea'); ta.value = tsv; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
    var ok = false; try { ok = document.execCommand('copy'); } catch (e) { } document.body.removeChild(ta);
    toast(ok ? 'Tabela je kopirana. Nalepite je u Excel ili Google Sheets.' : 'Kopiranje nije uspelo u ovom pregledaču.');
  }
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(tsv).then(function () { toast('Tabela je kopirana. Nalepite je u Excel ili Google Sheets.'); }, fallback);
  else fallback();
}

/* ---------- events ---------- */
function bind() {
  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault(); $('loginErr').textContent = '';
    api('/api/login', { method: 'POST', body: JSON.stringify({ email: $('email').value, password: $('password').value }) })
      .then(function (me) { S.me = me; $('password').value = ''; enterApp(); })
      .catch(function (err) { $('loginErr').textContent = err.message; });
  });
  $('logout').addEventListener('click', function () { api('/api/logout', { method: 'POST', body: '{}' }).then(function () { S.rows = []; showLogin(); }); });

  $('syncBtn').addEventListener('click', function () {
    var b = $('syncBtn'); b.disabled = true; b.textContent = 'Osvežavam...';
    api('/api/sync', { method: 'POST', body: '{}' })
      .then(function (out) {
        if (!out.results.length) toast('Nijedan API nije podešen na serveru.');
        else toast(out.results.map(function (r) { return P[r.platform].name + ': ' + (r.ok ? r.rows + ' redova' : 'greška'); }).join(', '));
        return loadConfig().then(loadRows);
      })
      .catch(function (e) { toast(e.message); })
      .then(function () { b.disabled = false; b.textContent = 'Osveži podatke'; });
  });

  document.querySelectorAll('.source').forEach(function (el) {
    var key = el.getAttribute('data-key');
    if (!el.querySelector('[data-file]')) return; // Analytics kartica nema CSV uvoz
    el.querySelector('[data-file]').addEventListener('change', function (e) { var f = e.target.files[0]; if (f) importFile(key, f); e.target.value = ''; });
    el.querySelector('[data-remove]').addEventListener('click', function () {
      api('/api/import/' + key, { method: 'DELETE' }).then(function () { toast('Uvezeni CSV podaci su uklonjeni.'); return loadConfig().then(loadRows); }).catch(function (e) { toast(e.message); });
    });
  });

  $('from').addEventListener('change', function (e) { S.from = e.target.value; markPreset(0); loadRows(); });
  $('to').addEventListener('change', function (e) { S.to = e.target.value; markPreset(0); loadRows(); });
  $('presets').addEventListener('click', function (e) { var b = e.target.closest('[data-days]'); if (b) setPreset(+b.getAttribute('data-days')); });
  $('q').addEventListener('input', function (e) { S.q = e.target.value.trim().toLowerCase(); render(); });
  $('plat').addEventListener('click', function (e) {
    var b = e.target.closest('[data-plat]'); if (!b) return; S.plat = b.getAttribute('data-plat');
    document.querySelectorAll('#plat button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    render();
  });
  $('trend').addEventListener('click', function (e) { var b = e.target.closest('[data-metric]'); if (!b) return; S.metric = b.getAttribute('data-metric'); render(); });
  $('table').addEventListener('click', function (e) {
    var b = e.target.closest('[data-sort]'); if (!b) return; var k = b.getAttribute('data-sort');
    if (S.sort === k) S.dir = -S.dir; else { S.sort = k; S.dir = (k === 'c' || k === 'p') ? 1 : -1; }
    render();
  });
  $('copy').addEventListener('click', copyTable);
  $('userForm').addEventListener('submit', function (e) {
    e.preventDefault();
    api('/api/users', { method: 'POST', body: JSON.stringify({ email: $('uEmail').value, password: $('uPass').value, role: $('uRole').value }) })
      .then(function () { toast('Korisnik je sačuvan.'); $('uEmail').value = ''; $('uPass').value = ''; return loadUsers(); })
      .catch(function (err) { toast(err.message); });
  });
  $('usersTable').addEventListener('click', function (e) {
    var b = e.target.closest('[data-del]'); if (!b) return;
    api('/api/users/' + b.getAttribute('data-del'), { method: 'DELETE' })
      .then(function () { toast('Korisnik je obrisan.'); return loadUsers(); })
      .catch(function (err) { toast(err.message); });
  });
  $('gaScope').addEventListener('click', function (e) {
    var b = e.target.closest('[data-scope]'); if (!b) return; S.gaScope = b.getAttribute('data-scope');
    document.querySelectorAll('#gaScope button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    render();
  });
}

bind();
api('/api/me').then(function (me) { S.me = me; enterApp(); }).catch(function () { showLogin(); });
})();
