'use strict';
try { require('dotenv').config(); } catch (e) { /* dotenv je opcion (lokalni razvoj) */ }

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const db = require('./db');
const sync = require('./sync');
const { today, addDays, diffDays, isDate, toNum } = require('./util');

const ON_VERCEL = !!process.env.VERCEL;
const PROD = process.env.NODE_ENV === 'production' || ON_VERCEL;
const COOKIE = 'kp_session';
const PLATFORMS = ['meta', 'google'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Hash za poređenje kada korisnik ne postoji (isto vreme odgovora).
const DUMMY_HASH = bcrypt.hashSync('nepostojeca-lozinka', 10);

function jwtSecret() {
  const s = process.env.JWT_SECRET;
  if (s && s.length >= 32) return s;
  if (PROD) throw new Error('JWT_SECRET mora imati bar 32 znaka.');
  return 'dev-only-secret-dev-only-secret-dev-only';
}

// Obuhvata async rukovaoce da se greške prosleđuju Express-u (Express 4 to ne radi sam).
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const clientIp = (req) => req.get('x-vercel-forwarded-for') || req.get('x-real-ip') || req.ip || 'nepoznato';

let readyPromise = null;
async function bootstrapAdmin() {
  if ((await db.countUsers()) > 0) return;
  const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (ADMIN_EMAIL && ADMIN_PASSWORD && ADMIN_PASSWORD.length >= 10) {
    await db.saveUser(ADMIN_EMAIL, bcrypt.hashSync(ADMIN_PASSWORD, 12), 'admin');
    console.log('[start] Napravljen administratorski nalog:', ADMIN_EMAIL);
  } else {
    console.warn('[start] Nema korisnika. Podesite ADMIN_EMAIL i ADMIN_PASSWORD (bar 10 znakova).');
  }
}
// Pravi tabele i prvog administratora pri prvom zahtevu (jednom po instanci).
function ensureReady() {
  if (!readyPromise) {
    readyPromise = (async () => { await db.ensureSchema(); await bootstrapAdmin(); })()
      .catch((e) => { readyPromise = null; throw e; });
  }
  return readyPromise;
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet({ frameguard: false, contentSecurityPolicy: false })); // CSP za stranice postavlja vercel.json
  app.use(express.json({ limit: '4mb' })); // Vercel ograničava telo zahteva na oko 4,5 MB
  app.use(cookieParser());

  // Zaštita od CSRF: kolačić je SameSite=Lax, a dodatno proveravamo Origin na izmenama.
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const origin = req.get('origin');
    if (origin) {
      let host = '';
      try { host = new URL(origin).host; } catch (e) { /* neispravan origin */ }
      if (host !== (req.get('x-forwarded-host') || req.get('host'))) return res.status(403).json({ error: 'Zahtev je odbijen.' });
    }
    if (req.method === 'POST' && !req.is('application/json')) return res.status(415).json({ error: 'Očekivan je JSON.' });
    next();
  });

  app.get('/api/health', ah(async (req, res) => {
    let dbOk = false;
    try { await db.query('SELECT 1'); dbOk = true; } catch (e) { console.error('[health]', e.message); }
    res.json({ ok: true, db: dbOk });
  }));

  // Sve ispod zahteva spremnu bazu.
  app.use('/api', ah(async (req, res, next) => { await ensureReady(); next(); }));

  // Vercel Cron poziva ovu putanju sa zaglavljem Authorization: Bearer <CRON_SECRET>.
  app.get('/api/cron/sync', ah(async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) return res.status(503).json({ error: 'CRON_SECRET nije podešen.' });
    const got = Buffer.from(req.get('authorization') || '');
    const want = Buffer.from('Bearer ' + secret);
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return res.status(401).json({ error: 'Neovlašćeno.' });
    const days = (await db.hasSuccessfulSync()) ? 35 : 90;
    try {
      res.json({ results: await sync.runSync({ days }) });
    } catch (e) {
      if (e.code === 'BUSY') return res.json({ skipped: true, reason: e.message });
      throw e;
    }
  }));

  const auth = ah(async (req, res, next) => {
    let payload;
    try { payload = jwt.verify(req.cookies[COOKIE] || '', jwtSecret(), { algorithms: ['HS256'] }); }
    catch (e) { return res.status(401).json({ error: 'Niste prijavljeni.' }); }
    const u = await db.getUserById(payload.uid);
    if (!u) return res.status(401).json({ error: 'Niste prijavljeni.' });
    req.user = { id: u.id, email: u.email, role: u.role };
    next();
  });
  const admin = (req, res, next) => (req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Potrebna je administratorska dozvola.' }));

  app.post('/api/login', ah(async (req, res) => {
    const ip = clientIp(req);
    if ((await db.recentFailures(ip)) >= 10) {
      return res.status(429).json({ error: 'Previše pokušaja prijave. Pokušajte ponovo za 15 minuta.' });
    }
    const { email, password } = req.body || {};
    const u = typeof email === 'string' ? await db.getUserByEmail(email.trim()) : null;
    const ok = bcrypt.compareSync(typeof password === 'string' ? password : '', u ? u.hash : DUMMY_HASH);
    if (!u || !ok) {
      await db.addFailure(ip);
      return res.status(401).json({ error: 'Pogrešan email ili lozinka.' });
    }
    const token = jwt.sign({ uid: u.id }, jwtSecret(), { algorithm: 'HS256', expiresIn: '7d' });
    res.cookie(COOKIE, token, {
      httpOnly: true, sameSite: 'lax', secure: PROD && process.env.COOKIE_SECURE !== 'false',
      maxAge: 7 * 24 * 3600 * 1000, path: '/',
    });
    res.json({ email: u.email, role: u.role });
  }));

  app.post('/api/logout', (req, res) => {
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/me', auth, (req, res) => res.json({ email: req.user.email, role: req.user.role }));

  app.get('/api/config', auth, ah(async (req, res) => {
    const conf = sync.configured();
    const [last, csv] = await Promise.all([db.lastSyncs(), db.csvCounts()]);
    const platforms = {};
    for (const p of [...PLATFORMS, 'ga4']) platforms[p] = { configured: conf[p], last: last[p] || null, csvRows: csv[p] || 0 };
    res.json({ currency: process.env.CURRENCY || 'RSD', platforms });
  }));

  // Čita i proverava period iz upita; ako je neispravan, šalje grešku i vraća null.
  function period(req, res) {
    const t = today();
    const from = req.query.from || addDays(t, -29);
    const to = req.query.to || t;
    let err = null;
    if (!isDate(from) || !isDate(to)) err = 'Datum mora biti u formatu GGGG-MM-DD.';
    else if (to < from) err = 'Datum "Do" ne može biti pre datuma "Od".';
    else if (diffDays(from, to) > 800) err = 'Period može imati najviše 800 dana.';
    if (err) { res.status(400).json({ error: err }); return null; }
    return { from, to };
  }

  app.get('/api/ga', auth, ah(async (req, res) => {
    const p = period(req, res); if (!p) return;
    const fx = toNum(process.env.FX_GA4) > 0 ? toNum(process.env.FX_GA4) : 1;
    res.json((await db.gaRowsBetween(p.from, p.to)).map((r) => ({ ...r, r: r.r * fx })));
  }));

  app.get('/api/rows', auth, ah(async (req, res) => {
    const p = period(req, res); if (!p) return;
    const fx = {
      meta: toNum(process.env.FX_META) > 0 ? toNum(process.env.FX_META) : 1,
      google: toNum(process.env.FX_GOOGLE) > 0 ? toNum(process.env.FX_GOOGLE) : 1,
    };
    res.json((await db.rowsBetween(p.from, p.to)).map((r) => ({ ...r, s: r.s * fx[r.p], r: r.r * fx[r.p] })));
  }));

  app.post('/api/sync', auth, admin, ah(async (req, res) => {
    const body = req.body || {};
    const only = ['meta', 'google', 'ga4'].includes(body.only) ? body.only : null;
    const asked = parseInt(body.days, 10);
    const days = asked > 0 ? Math.min(400, asked) : ((await db.hasSuccessfulSync()) ? 35 : 90);
    try {
      res.json({ results: await sync.runSync({ days, only }) });
    } catch (e) {
      if (e.code === 'BUSY') return res.status(409).json({ error: e.message });
      throw e;
    }
  }));

  app.post('/api/import/:platform', auth, admin, ah(async (req, res) => {
    const platform = req.params.platform;
    if (!PLATFORMS.includes(platform)) return res.status(404).json({ error: 'Nepoznata platforma.' });
    const input = req.body && req.body.rows;
    if (!Array.isArray(input) || !input.length) return res.status(400).json({ error: 'Nema redova za uvoz.' });
    if (input.length > 30000) return res.status(400).json({ error: 'Previše redova za jedan uvoz (najviše 30.000). Podelite izvoz na manje periode.' });

    const map = new Map();
    for (const r of input) {
      if (!r || typeof r.c !== 'string' || !r.c.trim() || r.c.length > 300 || !isDate(r.d)) {
        return res.status(400).json({ error: 'Svaki red mora imati naziv kampanje i datum (GGGG-MM-DD).' });
      }
      const key = r.c.trim() + '\u0000' + r.d;
      let a = map.get(key);
      if (!a) { a = { campaign: r.c.trim(), date: r.d, spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 }; map.set(key, a); }
      a.spend += toNum(r.s); a.impressions += toNum(r.i); a.clicks += toNum(r.k); a.conversions += toNum(r.v); a.revenue += toNum(r.r);
    }
    const rows = [...map.values()];
    const dates = rows.map((r) => r.date).sort();
    await db.replaceWindow(platform, 'csv', dates[0], dates[dates.length - 1], rows);
    res.json({ imported: rows.length, from: dates[0], to: dates[dates.length - 1] });
  }));

  app.delete('/api/import/:platform', auth, admin, ah(async (req, res) => {
    const platform = req.params.platform;
    if (!PLATFORMS.includes(platform)) return res.status(404).json({ error: 'Nepoznata platforma.' });
    res.json({ deleted: await db.deleteCsv(platform) });
  }));

  /* ---------- korisnici (samo administrator) ---------- */
  app.get('/api/users', auth, admin, ah(async (req, res) => res.json(await db.listUsers())));

  app.post('/api/users', auth, admin, ah(async (req, res) => {
    const { email, password, role } = req.body || {};
    if (typeof email !== 'string' || !EMAIL_RE.test(email.trim()) || email.length > 200) return res.status(400).json({ error: 'Neispravan email.' });
    if (typeof password !== 'string' || password.length < 10 || password.length > 200) return res.status(400).json({ error: 'Lozinka mora imati bar 10 znakova.' });
    if (!['admin', 'viewer'].includes(role)) return res.status(400).json({ error: 'Uloga mora biti admin ili viewer.' });
    if (email.trim().toLowerCase() === req.user.email && role !== 'admin') return res.status(400).json({ error: 'Ne možete sebi da oduzmete administratorsku ulogu.' });
    await db.saveUser(email.trim(), bcrypt.hashSync(password, 12), role);
    res.json({ ok: true });
  }));

  app.delete('/api/users/:id', auth, admin, ah(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Neispravan ID.' });
    if (id === req.user.id) return res.status(400).json({ error: 'Ne možete obrisati sopstveni nalog.' });
    const target = await db.getUserById(id);
    if (!target) return res.status(404).json({ error: 'Korisnik ne postoji.' });
    if (target.role === 'admin' && (await db.countAdmins()) <= 1) return res.status(400).json({ error: 'Mora ostati bar jedan administrator.' });
    await db.deleteUser(id);
    res.json({ ok: true });
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Nepoznata putanja.' }));
  // Na Vercelu statičke fajlove servira CDN (folder public). Lokalno ih servira Express.
  if (!ON_VERCEL) app.use(express.static(path.join(__dirname, '..', 'public')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Fajl je prevelik.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Neispravan JSON.' });
    console.error('[greška]', err.message);
    res.status(500).json({ error: 'Greška na serveru.' });
  });

  return app;
}

module.exports = { createApp, ensureReady };
