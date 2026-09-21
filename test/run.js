'use strict';
// Test bez spoljnih servisa: lažni Meta/Google/GA4 API serveri, prava Express aplikacija
// i pravi Postgres (PGlite, Postgres kompajliran u WebAssembly) umesto Supabase-a.
const assert = require('assert');
const http = require('http');
const crypto = require('crypto');

process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123';
process.env.APP_TIMEZONE = 'Europe/Belgrade';
process.env.ADMIN_EMAIL = 'Admin@Primer.rs';
process.env.ADMIN_PASSWORD = 'dugacka-lozinka-1';
process.env.META_ACCESS_TOKEN = 'meta-token';
process.env.META_AD_ACCOUNT_IDS = '123';
process.env.META_CONVERSION_ACTION = 'purchase';
process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'dev-token';
process.env.GOOGLE_CLIENT_ID = 'cid';
process.env.GOOGLE_CLIENT_SECRET = 'csecret';
process.env.GOOGLE_REFRESH_TOKEN = 'rtoken';
process.env.GOOGLE_ADS_CUSTOMER_IDS = '123-456-7890';
process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = '999-888-7777';
process.env.FX_META = '2';

// GA4: servisni nalog sa pravim RSA ključem, zadat kao ceo JSON (kao na Vercelu).
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA_EMAIL = 'portal@projekat.iam.gserviceaccount.com';
const SA_JSON = JSON.stringify({ client_email: SA_EMAIL, private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
process.env.GA4_SERVICE_ACCOUNT_JSON = SA_JSON;
process.env.GA4_PROPERTY_IDS = 'properties/555';
process.env.GA4_KEY_EVENT_NAME = 'purchase';
process.env.FX_GA4 = '3';

const seen = { google: null, meta: [], ga: [], gaAuth: [] };
const GA_MAIN = [
  { dims: ['20260920', 'google', 'cpc', 'Search A'], mets: ['40', '30', '4', '200'] },
  { dims: ['20260920', 'instagram', 'paid_social', 'IG Reels'], mets: ['25', '10', '2', '90'] },
  { dims: ['20260919', '(direct)', '(none)', '(not set)'], mets: ['10', '5', '0', '0'] },
];
const GA_EVENTS = [
  { dims: ['20260920', 'google', 'cpc', 'Search A'], mets: ['3'] },
  { dims: ['20260920', 'instagram', 'paid_social', 'IG Reels'], mets: ['1'] },
];
let mockPort;

const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (u.pathname === '/v25.0/act_123/insights') {
      seen.meta.push(Object.fromEntries(u.searchParams));
      if (u.searchParams.get('access_token') !== 'meta-token') return send(400, { error: { message: 'bad token' } });
      if (u.searchParams.get('page') === '2') {
        return send(200, { data: [{ campaign_name: 'IG Reels', date_start: '2026-09-19', publisher_platform: 'instagram', spend: '5.5', impressions: '500', inline_link_clicks: '10', actions: [], action_values: [] }] });
      }
      return send(200, {
        data: [
          { campaign_name: 'IG Reels', date_start: '2026-09-20', publisher_platform: 'instagram', spend: '12.50', impressions: '1000', inline_link_clicks: '30', actions: [{ action_type: 'purchase', value: '2' }, { action_type: 'link_click', value: '30' }], action_values: [{ action_type: 'purchase', value: '80' }] },
          { campaign_name: 'IG Reels', date_start: '2026-09-20', publisher_platform: 'instagram', spend: '1', impressions: '100', inline_link_clicks: '1', actions: [], action_values: [] },
          { campaign_name: 'FB only', date_start: '2026-09-20', publisher_platform: 'facebook', spend: '99', impressions: '9', inline_link_clicks: '9' },
        ],
        paging: { next: `http://127.0.0.1:${mockPort}/v25.0/act_123/insights?access_token=meta-token&page=2` },
      });
    }
    if (u.pathname === '/token' && new URLSearchParams(body).get('grant_type') === 'urn:ietf:params:oauth:grant-type:jwt-bearer') {
      const [h, c, s] = new URLSearchParams(body).get('assertion').split('.');
      const okSig = crypto.createVerify('RSA-SHA256').update(h + '.' + c).verify(publicKey, Buffer.from(s, 'base64url'));
      const claim = JSON.parse(Buffer.from(c, 'base64url').toString());
      if (!okSig || claim.iss !== SA_EMAIL || !claim.scope.includes('analytics.readonly')) return send(400, { error: 'invalid_grant' });
      return send(200, { access_token: 'ga-access', expires_in: 3600 });
    }
    if (u.pathname === '/v1beta/properties/555:runReport') {
      const b = JSON.parse(body);
      seen.gaAuth.push(req.headers.authorization);
      seen.ga.push(b);
      if (!/^Bearer (ga|g)-access$/.test(req.headers.authorization)) return send(401, { error: { message: 'unauth' } });
      const isEvents = b.metrics[0].name === 'eventCount';
      if (isEvents && b.dimensionFilter.filter.stringFilter.value !== 'purchase') return send(400, { error: { message: 'pogresan filter' } });
      const all = isEvents ? GA_EVENTS : GA_MAIN;
      const off = parseInt(b.offset, 10) || 0;
      const page = all.slice(off, off + 2).map((r) => ({ dimensionValues: r.dims.map((value) => ({ value })), metricValues: r.mets.map((value) => ({ value })) }));
      return send(200, { rows: page, rowCount: all.length });
    }
    if (u.pathname === '/token') {
      const p = new URLSearchParams(body);
      if (p.get('refresh_token') !== 'rtoken' || p.get('grant_type') !== 'refresh_token') return send(400, { error: 'invalid_grant' });
      return send(200, { access_token: 'g-access', expires_in: 3600 });
    }
    if (u.pathname === '/v25/customers/1234567890/googleAds:searchStream') {
      seen.google = { headers: req.headers, body: JSON.parse(body) };
      if (req.headers.authorization !== 'Bearer g-access') return send(401, [{ error: { message: 'unauth' } }]);
      return send(200, [{ results: [{ campaign: { name: 'Search A' }, segments: { date: '2026-09-20' }, metrics: { costMicros: '12500000', impressions: '2000', clicks: '50', conversions: 3.5, conversionsValue: 120 } }] }]);
    }
    send(404, { error: { message: 'nepoznato ' + u.pathname } });
  });
});

async function main() {
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  mockPort = mock.address().port;
  process.env.META_BASE_URL = `http://127.0.0.1:${mockPort}`;
  process.env.GOOGLE_ADS_BASE_URL = `http://127.0.0.1:${mockPort}`;
  process.env.GOOGLE_TOKEN_URL = `http://127.0.0.1:${mockPort}/token`;
  process.env.GA4_BASE_URL = `http://127.0.0.1:${mockPort}`;

  const { PGlite } = require('@electric-sql/pglite');
  const pg = new PGlite();
  await pg.waitReady;
  const db = require('../lib/db');
  db.useExecutor({ query: (t, p) => pg.query(t, p), connect: async () => ({ query: (t, p) => pg.query(t, p), release() {} }) });

  const sync = require('../lib/sync');
  const { today, addDays } = require('../lib/util');
  const { createApp } = require('../lib/app');

  // ---- šema ----
  await db.ensureSchema();
  await db.ensureSchema();
  const rls = await db.query("SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('users','daily','ga_daily','sync_log','sync_lock','login_attempts')");
  assert.strictEqual(rls.length, 6);
  assert.ok(rls.every((r) => r.relrowsecurity), 'RLS mora biti uključen na svim tabelama');
  console.log('ok  šema (idempotentna, RLS uključen na svih 6 tabela)');

  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, url, body, extra = {}) => {
    const r = await fetch(base + url, {
      method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extra },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = r.headers.get('set-cookie');
    if (sc && sc.startsWith('kp_session=') && !sc.includes('Expires=Thu, 01 Jan 1970')) cookie = sc.split(';')[0];
    let j = null; try { j = await r.json(); } catch (e) { /* nije JSON */ }
    return { status: r.status, json: j, headers: r.headers };
  };

  assert.deepStrictEqual((await call('GET', '/api/health')).json, { ok: true, db: true });
  assert.strictEqual((await call('GET', '/api/rows')).status, 401);
  assert.strictEqual((await call('POST', '/api/login', { email: 'admin@primer.rs', password: 'pogresna' })).status, 401);
  const login = await call('POST', '/api/login', { email: 'admin@primer.rs', password: 'dugacka-lozinka-1' });
  assert.strictEqual(login.status, 200, 'prvi admin se pravi iz ADMIN_EMAIL/ADMIN_PASSWORD');
  assert.strictEqual(login.json.role, 'admin');
  console.log('ok  prvi administrator iz promenljivih okruženja, prijava i zaštita API-ja');

  // ---- Vercel Cron ----
  delete process.env.CRON_SECRET;
  assert.strictEqual((await call('GET', '/api/cron/sync')).status, 503);
  process.env.CRON_SECRET = 'cron-tajna-cron-tajna';
  assert.strictEqual((await call('GET', '/api/cron/sync')).status, 401);
  assert.strictEqual((await call('GET', '/api/cron/sync', null, { Authorization: 'Bearer pogresno' })).status, 401);
  const cron = await call('GET', '/api/cron/sync', null, { Authorization: 'Bearer cron-tajna-cron-tajna' });
  assert.strictEqual(cron.status, 200, JSON.stringify(cron.json));
  assert.deepStrictEqual(cron.json.results.map((r) => [r.platform, r.ok]), [['meta', true], ['google', true], ['ga4', true]], JSON.stringify(cron.json));
  const tr = JSON.parse(seen.meta[0].time_range);
  assert.strictEqual(tr.since, addDays(today(), -89), 'prvo osvežavanje povlači 90 dana');
  assert.strictEqual(tr.until, today());
  console.log('ok  Vercel Cron (zaštita tajnom, prvo osvežavanje 90 dana, sva tri izvora)');

  assert.strictEqual(seen.google.headers['developer-token'], 'dev-token');
  assert.strictEqual(seen.google.headers['login-customer-id'], '9998887777');
  assert.strictEqual(seen.meta[0].breakdowns, 'publisher_platform');

  const rows = await call('GET', '/api/rows?from=2026-09-01&to=2026-09-30');
  assert.strictEqual(rows.status, 200);
  const ig20 = rows.json.find((r) => r.p === 'meta' && r.d === '2026-09-20');
  assert.ok(ig20, 'nema Meta reda');
  assert.strictEqual(ig20.s, 13.5 * 2, 'spajanje istih kampanja + FX_META=2');
  assert.deepStrictEqual([ig20.c, ig20.k, ig20.v, ig20.r], ['IG Reels', 31, 2, 160]);
  assert.ok(!rows.json.some((r) => r.c === 'FB only'), 'Facebook red mora biti izostavljen');
  assert.ok(rows.json.some((r) => r.p === 'meta' && r.d === '2026-09-19'), 'druga stranica Meta rezultata');
  const g = rows.json.find((r) => r.p === 'google');
  assert.deepStrictEqual([g.c, g.s, g.i, g.k, g.v, g.r], ['Search A', 12.5, 2000, 50, 3.5, 120]);
  console.log('ok  /api/rows (agregacija, FX, filter)');

  const ga = await call('GET', '/api/ga?from=2026-09-01&to=2026-09-30');
  assert.strictEqual(ga.json.length, 3, 'paginacija GA4 izveštaja');
  const gs = ga.json.find((r) => r.src === 'google');
  assert.deepStrictEqual([gs.d, gs.med, gs.c, gs.ss, gs.es, gs.ke, gs.r], ['2026-09-20', 'cpc', 'Search A', 40, 30, 3, 600]);
  assert.strictEqual(ga.json.find((r) => r.src === 'instagram').ke, 1);
  assert.strictEqual(seen.gaAuth[0], 'Bearer ga-access');
  console.log('ok  GA4 (servisni nalog iz JSON promenljive, JWT, paginacija, filtriran ključni događaj, FX)');

  const ga4 = require('../lib/ga4');
  delete process.env.GA4_SERVICE_ACCOUNT_JSON;
  assert.strictEqual(ga4.configured(), true);
  await ga4.fetchProperty('555', '2026-09-01', '2026-09-30');
  assert.strictEqual(seen.gaAuth[seen.gaAuth.length - 1], 'Bearer g-access');
  process.env.GA4_SERVICE_ACCOUNT_B64 = Buffer.from(SA_JSON).toString('base64');
  await ga4.fetchProperty('555', '2026-09-01', '2026-09-30');
  assert.strictEqual(seen.gaAuth[seen.gaAuth.length - 1], 'Bearer ga-access');
  console.log('ok  GA4 rezerve: OAuth refresh token i base64 ključ');

  const cfg = await call('GET', '/api/config');
  assert.strictEqual(cfg.json.platforms.ga4.configured, true);
  assert.strictEqual(cfg.json.platforms.ga4.last.rows, 3);
  assert.strictEqual(cfg.json.platforms.google.last.ok, true);
  assert.ok(!JSON.stringify(cfg.json).includes('meta-token'), 'token ne sme da procuri');
  assert.strictEqual((await call('GET', '/api/rows?from=2026-13-01&to=2026-09-30')).status, 400);
  assert.strictEqual((await call('GET', '/api/rows?from=2026-09-30&to=2026-09-01')).status, 400);

  // ---- brava i ručno osvežavanje ----
  assert.strictEqual(await db.acquireSyncLock(6), true);
  assert.strictEqual(await db.acquireSyncLock(6), false, 'druga instanca ne sme da uđe');
  assert.strictEqual((await call('POST', '/api/sync', { days: 5 })).status, 409);
  const skipped = await call('GET', '/api/cron/sync', null, { Authorization: 'Bearer cron-tajna-cron-tajna' });
  assert.strictEqual(skipped.json.skipped, true);
  await db.releaseSyncLock();
  const before = seen.meta.length;
  const manual = await call('POST', '/api/sync', { only: 'meta' });
  assert.strictEqual(manual.status, 200);
  assert.deepStrictEqual(manual.json.results.map((r) => r.platform), ['meta']);
  assert.strictEqual(JSON.parse(seen.meta[before].time_range).since, addDays(today(), -34), 'posle prvog uspeha podrazumevano 35 dana');
  console.log('ok  brava između instanci i osvežavanje samo jednog izvora');

  // ---- CSV uvoz ----
  const imp = await call('POST', '/api/import/google', { rows: [{ c: 'CSV kampanja', d: '2026-08-10', s: 100, i: 1000, k: 20, v: 1, r: 500 }, { c: 'CSV kampanja', d: '2026-08-10', s: 50, i: 500, k: 10, v: 0, r: 0 }] });
  assert.strictEqual(imp.json.imported, 1);
  assert.strictEqual((await call('GET', '/api/rows?from=2026-08-01&to=2026-08-31')).json[0].s, 150);
  assert.strictEqual((await call('POST', '/api/import/google', { rows: [{ c: 'X', d: 'nije-datum', s: 1 }] })).status, 400);
  assert.strictEqual((await call('POST', '/api/import/tiktok', { rows: [] })).status, 404);
  assert.strictEqual((await call('DELETE', '/api/import/google')).json.deleted, 1);
  // veliki uvoz prolazi u više paketa
  const big = Array.from({ length: 12000 }, (_, i) => ({ c: 'K' + i, d: '2026-07-01', s: 1, i: 1, k: 1, v: 0, r: 0 }));
  const bigRes = await call('POST', '/api/import/meta', { rows: big });
  assert.strictEqual(bigRes.json.imported, 12000);
  assert.strictEqual((await call('DELETE', '/api/import/meta')).json.deleted, 12000);
  console.log('ok  CSV uvoz, brisanje i uvoz od 12.000 redova u paketima');

  // ---- CSRF ----
  const host = `127.0.0.1:${server.address().port}`;
  assert.strictEqual((await call('POST', '/api/sync', { days: 5 }, { Origin: 'https://zlonamerni.example' })).status, 403);
  assert.strictEqual((await call('POST', '/api/sync', { only: 'ga4' }, { Origin: 'http://' + host })).status, 200);
  console.log('ok  provera Origin zaglavlja');

  // ---- upravljanje korisnicima ----
  assert.strictEqual((await call('POST', '/api/users', { email: 'nije-mejl', password: 'dugacka-lozinka-2', role: 'viewer' })).status, 400);
  assert.strictEqual((await call('POST', '/api/users', { email: 'g@primer.rs', password: 'kratka', role: 'viewer' })).status, 400);
  assert.strictEqual((await call('POST', '/api/users', { email: 'g@primer.rs', password: 'dugacka-lozinka-2', role: 'bog' })).status, 400);
  assert.strictEqual((await call('POST', '/api/users', { email: 'Gledalac@Primer.rs', password: 'dugacka-lozinka-2', role: 'viewer' })).status, 200);
  const users = (await call('GET', '/api/users')).json;
  assert.deepStrictEqual(users.map((u) => u.email), ['admin@primer.rs', 'gledalac@primer.rs']);
  assert.ok(users.every((u) => !('hash' in u)), 'hash lozinke ne sme da se šalje');
  const me = users.find((u) => u.email === 'admin@primer.rs');
  assert.strictEqual((await call('DELETE', '/api/users/' + me.id)).status, 400, 'ne može obrisati sebe');
  assert.strictEqual((await call('POST', '/api/users', { email: 'admin@primer.rs', password: 'dugacka-lozinka-1', role: 'viewer' })).status, 400, 'ne može sebi oduzeti ulogu');
  console.log('ok  korisnici (dodavanje, validacija, zaštita od zaključavanja)');

  // ---- viewer nema admin dozvole ----
  cookie = '';
  assert.strictEqual((await call('POST', '/api/login', { email: 'gledalac@primer.rs', password: 'dugacka-lozinka-2' })).status, 200);
  assert.strictEqual((await call('GET', '/api/rows?from=2026-09-01&to=2026-09-30')).status, 200);
  for (const [m, u, b] of [['POST', '/api/sync', {}], ['POST', '/api/import/meta', { rows: [{ c: 'a', d: '2026-09-01' }] }], ['GET', '/api/users'], ['POST', '/api/users', { email: 'x@y.rs', password: 'dugacka-lozinka-3', role: 'admin' }]]) {
    assert.strictEqual((await call(m, u, b)).status, 403, m + ' ' + u);
  }
  const viewerId = users.find((u) => u.email === 'gledalac@primer.rs').id;
  console.log('ok  uloga viewer je samo za čitanje');

  // ---- admin briše viewera; poslednji admin ostaje ----
  cookie = '';
  await call('POST', '/api/login', { email: 'admin@primer.rs', password: 'dugacka-lozinka-1' });
  assert.strictEqual((await call('DELETE', '/api/users/' + viewerId)).status, 200);
  assert.strictEqual((await call('GET', '/api/users')).json.length, 1);
  assert.strictEqual((await db.countAdmins()), 1);

  // ---- ograničenje pokušaja prijave (u bazi) ----
  const bad = { 'x-real-ip': '203.0.113.7' };
  for (let i = 0; i < 10; i++) assert.strictEqual((await call('POST', '/api/login', { email: 'admin@primer.rs', password: 'pogresna' }, bad)).status, 401);
  assert.strictEqual((await call('POST', '/api/login', { email: 'admin@primer.rs', password: 'dugacka-lozinka-1' }, bad)).status, 429);
  assert.strictEqual((await call('POST', '/api/login', { email: 'admin@primer.rs', password: 'dugacka-lozinka-1' }, { 'x-real-ip': '198.51.100.9' })).status, 200);
  console.log('ok  ograničenje pokušaja prijave po IP adresi');

  // ---- neuspeh jednog API-ja ne ruši drugi i beleži se ----
  process.env.META_ACCESS_TOKEN = 'pogresan';
  const res2 = await sync.runSync({ days: 35 });
  assert.strictEqual(res2.find((r) => r.platform === 'meta').ok, false);
  assert.strictEqual(res2.find((r) => r.platform === 'google').ok, true);
  const last = await db.lastSyncs();
  assert.ok(last.meta.message.includes('bad token'));
  assert.ok(!last.meta.message.includes('pogresan'), 'token ne sme u log');
  console.log('ok  greške su izolovane po platformi');

  server.close(); mock.close();
  console.log('\nSvi testovi su prošli.');
  process.exit(0);
}

main().catch((e) => { console.error('\nTEST NIJE PROŠAO:', e); process.exit(1); });
