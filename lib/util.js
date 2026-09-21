'use strict';

// TZ je rezervisana promenljiva na Vercelu (uvek UTC), zato se koristi APP_TIMEZONE.
const TZ = () => process.env.APP_TIMEZONE || 'Europe/Belgrade';

// Današnji datum (YYYY-MM-DD) u vremenskoj zoni servera/naloga.
function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

function addDays(s, n) {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function diffDays(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Spaja redove sa istim nazivom kampanje i datumom (dve kampanje mogu imati isto ime).
function aggregate(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = r.campaign + '\u0000' + r.date;
    let a = map.get(key);
    if (!a) {
      a = { campaign: r.campaign, date: r.date, spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 };
      map.set(key, a);
    }
    a.spend += r.spend; a.impressions += r.impressions; a.clicks += r.clicks;
    a.conversions += r.conversions; a.revenue += r.revenue;
  }
  return [...map.values()];
}

// Spaja GA4 redove sa istim datumom, izvorom, medijumom i kampanjom.
function aggregateGa(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = [r.date, r.source, r.medium, r.campaign].join('\u0000');
    let a = map.get(key);
    if (!a) { a = { date: r.date, source: r.source, medium: r.medium, campaign: r.campaign, sessions: 0, engaged: 0, keyEvents: 0, revenue: 0 }; map.set(key, a); }
    a.sessions += r.sessions; a.engaged += r.engaged; a.keyEvents += r.keyEvents; a.revenue += r.revenue;
  }
  return [...map.values()];
}

module.exports = { today, isDate, addDays, diffDays, toNum, aggregate, aggregateGa };
