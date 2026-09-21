'use strict';
// Sloj za bazu: Supabase Postgres preko `pg`.
// Datumi se čuvaju kao tekst GGGG-MM-DD (ISO tekst se ispravno poredi i nema problema sa vremenskim zonama).
const { Pool } = require('pg');

let exec = null; // { query(text, params), connect() } — pg Pool ili zamena u testovima
let schemaPromise = null;

function useExecutor(e) { exec = e; schemaPromise = null; }

function getExec() {
  if (exec) return exec;
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL nije podešen.');
  let ssl;
  if (process.env.DATABASE_SSL !== 'disable') {
    // Supabase zahteva šifrovanu vezu. Za strogu proveru sertifikata upišite Supabase CA u DATABASE_CA.
    ssl = process.env.DATABASE_CA ? { ca: process.env.DATABASE_CA } : { rejectUnauthorized: false };
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl,
    max: parseInt(process.env.PG_POOL_MAX, 10) || 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
  });
  pool.on('error', (e) => console.error('[db] greška veze:', e.message));
  exec = pool;
  return exec;
}

async function query(text, params = []) {
  return (await getExec().query(text, params)).rows;
}

async function tx(fn) {
  const c = await getExec().connect();
  try {
    await c.query('BEGIN');
    const out = await fn(async (text, params = []) => (await c.query(text, params)).rows);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch (e2) { /* veza je već prekinuta */ }
    throw e;
  } finally {
    c.release();
  }
}

const TABLES = ['users', 'daily', 'ga_daily', 'sync_log', 'sync_lock', 'login_attempts'];
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id SERIAL PRIMARY KEY,
     email TEXT UNIQUE NOT NULL,
     hash TEXT NOT NULL,
     role TEXT NOT NULL DEFAULT 'viewer',
     created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS daily (
     platform TEXT NOT NULL,
     account TEXT NOT NULL,
     campaign TEXT NOT NULL,
     day TEXT NOT NULL,
     spend DOUBLE PRECISION NOT NULL DEFAULT 0,
     impressions DOUBLE PRECISION NOT NULL DEFAULT 0,
     clicks DOUBLE PRECISION NOT NULL DEFAULT 0,
     conversions DOUBLE PRECISION NOT NULL DEFAULT 0,
     revenue DOUBLE PRECISION NOT NULL DEFAULT 0,
     PRIMARY KEY (platform, account, campaign, day))`,
  'CREATE INDEX IF NOT EXISTS daily_day ON daily(day)',
  `CREATE TABLE IF NOT EXISTS ga_daily (
     property TEXT NOT NULL,
     day TEXT NOT NULL,
     source TEXT NOT NULL,
     medium TEXT NOT NULL,
     campaign TEXT NOT NULL,
     sessions DOUBLE PRECISION NOT NULL DEFAULT 0,
     engaged DOUBLE PRECISION NOT NULL DEFAULT 0,
     key_events DOUBLE PRECISION NOT NULL DEFAULT 0,
     revenue DOUBLE PRECISION NOT NULL DEFAULT 0,
     PRIMARY KEY (property, day, source, medium, campaign))`,
  'CREATE INDEX IF NOT EXISTS ga_daily_day ON ga_daily(day)',
  `CREATE TABLE IF NOT EXISTS sync_log (
     id SERIAL PRIMARY KEY,
     platform TEXT NOT NULL,
     started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     finished_at TIMESTAMPTZ,
     ok BOOLEAN,
     rows INTEGER,
     message TEXT)`,
  `CREATE TABLE IF NOT EXISTS sync_lock (
     name TEXT PRIMARY KEY,
     locked_until TIMESTAMPTZ NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS login_attempts (
     ip TEXT NOT NULL,
     at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  'CREATE INDEX IF NOT EXISTS login_attempts_ip ON login_attempts(ip, at)',
  // Supabase izlaže tabele iz šeme public preko javnog API-ja. Aplikacija se povezuje direktno kao vlasnik baze,
  // pa se RLS uključuje bez politika (niko preko javnog API-ja ne sme ništa da čita) i oduzimaju se prava ulogama anon/authenticated.
  ...TABLES.map((t) => `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`),
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
       REVOKE ALL ON TABLE ${TABLES.join(', ')} FROM anon;
     END IF;
     IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
       REVOKE ALL ON TABLE ${TABLES.join(', ')} FROM authenticated;
     END IF;
   END $$`,
];

// Pravi tabele ako ne postoje. Advisory lock sprečava trku kada se više instanci pokrene istovremeno.
function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = tx(async (q) => {
      await q('SELECT pg_advisory_xact_lock(884422)');
      for (const s of SCHEMA) await q(s);
    }).catch((e) => { schemaPromise = null; throw e; });
  }
  return schemaPromise;
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// Zamenjuje sve podatke jednog naloga u datom periodu (rešava preimenovane i obrisane kampanje).
async function replaceWindow(platform, account, from, to, rows) {
  await tx(async (q) => {
    await q('DELETE FROM daily WHERE platform = $1 AND account = $2 AND day >= $3 AND day <= $4', [platform, account, from, to]);
    for (const part of chunk(rows, 5000)) {
      await q(
        `INSERT INTO daily (platform, account, campaign, day, spend, impressions, clicks, conversions, revenue)
         SELECT $1::text, $2::text, t.campaign, t.day, t.spend, t.impressions, t.clicks, t.conversions, t.revenue
         FROM unnest($3::text[], $4::text[], $5::float8[], $6::float8[], $7::float8[], $8::float8[], $9::float8[])
              AS t(campaign, day, spend, impressions, clicks, conversions, revenue)
         ON CONFLICT (platform, account, campaign, day) DO UPDATE SET
           spend = EXCLUDED.spend, impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks,
           conversions = EXCLUDED.conversions, revenue = EXCLUDED.revenue`,
        [platform, account, part.map((r) => r.campaign), part.map((r) => r.date), part.map((r) => r.spend),
          part.map((r) => r.impressions), part.map((r) => r.clicks), part.map((r) => r.conversions), part.map((r) => r.revenue)]
      );
    }
  });
}

async function replaceGaWindow(property, from, to, rows) {
  await tx(async (q) => {
    await q('DELETE FROM ga_daily WHERE property = $1 AND day >= $2 AND day <= $3', [property, from, to]);
    for (const part of chunk(rows, 5000)) {
      await q(
        `INSERT INTO ga_daily (property, day, source, medium, campaign, sessions, engaged, key_events, revenue)
         SELECT $1::text, t.day, t.source, t.medium, t.campaign, t.sessions, t.engaged, t.key_events, t.revenue
         FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::float8[], $7::float8[], $8::float8[], $9::float8[])
              AS t(day, source, medium, campaign, sessions, engaged, key_events, revenue)
         ON CONFLICT (property, day, source, medium, campaign) DO UPDATE SET
           sessions = EXCLUDED.sessions, engaged = EXCLUDED.engaged,
           key_events = EXCLUDED.key_events, revenue = EXCLUDED.revenue`,
        [property, part.map((r) => r.date), part.map((r) => r.source), part.map((r) => r.medium), part.map((r) => r.campaign),
          part.map((r) => r.sessions), part.map((r) => r.engaged), part.map((r) => r.keyEvents), part.map((r) => r.revenue)]
      );
    }
  });
}

const rowsBetween = (from, to) => query(
  `SELECT platform AS p, campaign AS c, day AS d,
          SUM(spend)::float8 AS s, SUM(impressions)::float8 AS i, SUM(clicks)::float8 AS k,
          SUM(conversions)::float8 AS v, SUM(revenue)::float8 AS r
   FROM daily WHERE day BETWEEN $1 AND $2
   GROUP BY platform, campaign, day ORDER BY day`, [from, to]);

const gaRowsBetween = (from, to) => query(
  `SELECT day AS d, source AS src, medium AS med, campaign AS c,
          SUM(sessions)::float8 AS ss, SUM(engaged)::float8 AS es,
          SUM(key_events)::float8 AS ke, SUM(revenue)::float8 AS r
   FROM ga_daily WHERE day BETWEEN $1 AND $2
   GROUP BY day, source, medium, campaign ORDER BY day`, [from, to]);

async function csvCounts() {
  const out = { meta: 0, google: 0 };
  for (const r of await query("SELECT platform, COUNT(*)::int AS n FROM daily WHERE account = 'csv' GROUP BY platform")) out[r.platform] = r.n;
  return out;
}
async function deleteCsv(platform) {
  return (await query("DELETE FROM daily WHERE platform = $1 AND account = 'csv' RETURNING 1", [platform])).length;
}

/* ---------- evidencija osvežavanja ---------- */
async function startSync(platform) {
  return (await query('INSERT INTO sync_log (platform) VALUES ($1) RETURNING id', [platform]))[0].id;
}
async function finishSync(id, ok, rows, message) {
  await query('UPDATE sync_log SET finished_at = now(), ok = $2, rows = $3, message = $4 WHERE id = $1', [id, ok, rows, message]);
  await query("DELETE FROM sync_log WHERE started_at < now() - interval '90 days'");
}
async function lastSyncs() {
  const out = {};
  const rows = await query(
    `SELECT DISTINCT ON (platform) platform, finished_at, ok, rows, message
     FROM sync_log WHERE finished_at IS NOT NULL ORDER BY platform, id DESC`);
  for (const r of rows) out[r.platform] = { finished_at: r.finished_at, ok: !!r.ok, rows: r.rows, message: r.message };
  return out;
}
async function hasSuccessfulSync() {
  return (await query('SELECT 1 FROM sync_log WHERE ok = true AND finished_at IS NOT NULL LIMIT 1')).length > 0;
}

// Brava koja radi između više serverless instanci (u memoriji se ne može deliti).
async function acquireSyncLock(minutes = 6) {
  const r = await query(
    `INSERT INTO sync_lock (name, locked_until) VALUES ('sync', now() + ($1::int * interval '1 minute'))
     ON CONFLICT (name) DO UPDATE SET locked_until = EXCLUDED.locked_until
       WHERE sync_lock.locked_until < now()
     RETURNING name`, [minutes]);
  return r.length > 0;
}
const releaseSyncLock = () => query("UPDATE sync_lock SET locked_until = now() WHERE name = 'sync'");

/* ---------- korisnici ---------- */
const getUserByEmail = async (email) => (await query('SELECT id, email, hash, role FROM users WHERE email = $1', [String(email).toLowerCase()]))[0];
const getUserById = async (id) => (await query('SELECT id, email, hash, role FROM users WHERE id = $1', [id]))[0];
const listUsers = () => query('SELECT id, email, role, created_at FROM users ORDER BY email');
const countUsers = async () => (await query('SELECT COUNT(*)::int AS n FROM users'))[0].n;
const countAdmins = async () => (await query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin'"))[0].n;
const deleteUser = async (id) => (await query('DELETE FROM users WHERE id = $1 RETURNING id', [id])).length;
const saveUser = (email, hash, role) => query(
  `INSERT INTO users (email, hash, role) VALUES ($1, $2, $3)
   ON CONFLICT (email) DO UPDATE SET hash = EXCLUDED.hash, role = EXCLUDED.role`, [String(email).toLowerCase(), hash, role]);

/* ---------- ograničenje pokušaja prijave (u bazi, jer serverless nema deljenu memoriju) ---------- */
const recentFailures = async (ip) => (await query(
  "SELECT COUNT(*)::int AS n FROM login_attempts WHERE ip = $1 AND at > now() - interval '15 minutes'", [ip]))[0].n;
async function addFailure(ip) {
  await query('INSERT INTO login_attempts (ip) VALUES ($1)', [ip]);
  await query("DELETE FROM login_attempts WHERE at < now() - interval '1 day'");
}

module.exports = {
  useExecutor, query, tx, ensureSchema,
  replaceWindow, replaceGaWindow, rowsBetween, gaRowsBetween, csvCounts, deleteCsv,
  startSync, finishSync, lastSyncs, hasSuccessfulSync, acquireSyncLock, releaseSyncLock,
  getUserByEmail, getUserById, listUsers, countUsers, countAdmins, deleteUser, saveUser,
  recentFailures, addFailure,
};
