'use strict';
// Lokalno ručno osvežavanje: npm run sync -- [broj_dana]   (podrazumevano 35). Zahteva .env sa DATABASE_URL i API ključevima.
require('dotenv').config();
const db = require('../lib/db');
const { runSync, configured } = require('../lib/sync');

(async () => {
  const days = Math.max(1, Math.min(400, parseInt(process.argv[2], 10) || 35));
  const conf = configured();
  if (!conf.meta && !conf.google && !conf.ga4) throw new Error('Nijedan API nije podešen u .env fajlu.');
  await db.ensureSchema();
  const res = await runSync({ days });
  console.log(JSON.stringify(res, null, 2));
  process.exit(res.every((r) => r.ok) ? 0 : 2);
})().catch((e) => { console.error(e.message); process.exit(1); });
