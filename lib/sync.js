'use strict';
const db = require('./db');
const meta = require('./meta');
const google = require('./google');
const ga4 = require('./ga4');
const { today, addDays, aggregate, aggregateGa } = require('./util');

// Svaki izvor: kako se čitaju nalozi, kako se povlače podaci i gde se čuvaju.
const SOURCES = {
  meta: {
    configured: () => meta.configured(),
    ids: () => meta.accountIds(),
    load: async (id, since, until) => {
      const rows = aggregate(await meta.fetchAccount(id, since, until));
      await db.replaceWindow('meta', id, since, until, rows);
      return rows.length;
    },
  },
  google: {
    configured: () => google.configured(),
    ids: () => google.customerIds(),
    load: async (id, since, until) => {
      const rows = aggregate(await google.fetchAccount(id, since, until));
      await db.replaceWindow('google', id, since, until, rows);
      return rows.length;
    },
  },
  ga4: {
    configured: () => ga4.configured(),
    ids: () => ga4.propertyIds(),
    load: async (id, since, until) => {
      const rows = aggregateGa(await ga4.fetchProperty(id, since, until));
      await db.replaceGaWindow(id, since, until, rows);
      return rows.length;
    },
  },
};

function configured() {
  const out = {};
  for (const k of Object.keys(SOURCES)) out[k] = SOURCES[k].configured();
  return out;
}

async function syncSource(name, since, until) {
  const src = SOURCES[name];
  const logId = await db.startSync(name);
  let total = 0;
  const errors = [];
  for (const id of src.ids()) {
    try {
      total += (await src.load(id, since, until)) || 0;
    } catch (e) {
      errors.push(id + ': ' + e.message);
    }
  }
  await db.finishSync(logId, errors.length === 0, total, errors.join(' | ') || null);
  return { platform: name, ok: errors.length === 0, rows: total, errors };
}

// `only` (opciono) ograničava osvežavanje na jedan izvor, ako celo osvežavanje ne stane u vremensko ograničenje funkcije.
async function runSync({ days = 35, only = null } = {}) {
  if (!(await db.acquireSyncLock(6))) {
    const err = new Error('Osvežavanje je već u toku.');
    err.code = 'BUSY';
    throw err;
  }
  try {
    const until = today();
    const since = addDays(until, -(days - 1));
    const out = [];
    for (const name of Object.keys(SOURCES)) {
      if (only && only !== name) continue;
      if (SOURCES[name].configured()) out.push(await syncSource(name, since, until));
    }
    return out;
  } finally {
    await db.releaseSyncLock().catch(() => {});
  }
}

module.exports = { runSync, configured };
