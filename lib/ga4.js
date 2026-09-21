'use strict';
// Google Analytics 4 (Data API, runReport) — sesije, angažovane sesije, ključni događaji i prihod
// po datumu, izvoru, medijumu i kampanji.
// Autentikacija (jedna od dve opcije):
//  1) servisni nalog (preporučeno): GA4_SERVICE_ACCOUNT_JSON (ceo JSON ključ) ili GA4_SERVICE_ACCOUNT_B64,
//     a njegov email se doda kao "Viewer" u GA4 svojstvo;
//  2) isti OAuth refresh token kao za Google Ads, ako je odobren i za Analytics (npm run google-auth).
const crypto = require('crypto');
const fs = require('fs');
const { toNum } = require('./util');
const google = require('./google');

const base = () => process.env.GA4_BASE_URL || 'https://analyticsdata.googleapis.com';
const version = () => process.env.GA4_API_VERSION || 'v1beta';
const tokenUrl = () => process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const DIMS = ['date', 'sessionSource', 'sessionMedium', 'sessionCampaignName'];

const digits = (s) => String(s || '').replace(/\D/g, '');
const propertyIds = () => (process.env.GA4_PROPERTY_IDS || '').split(',').map(digits).filter(Boolean);

function serviceAccount() {
  try {
    let raw = null;
    if (process.env.GA4_SERVICE_ACCOUNT_JSON) raw = process.env.GA4_SERVICE_ACCOUNT_JSON;
    else if (process.env.GA4_SERVICE_ACCOUNT_B64) raw = Buffer.from(process.env.GA4_SERVICE_ACCOUNT_B64, 'base64').toString('utf8');
    else if (process.env.GA4_SERVICE_ACCOUNT_FILE) raw = fs.readFileSync(process.env.GA4_SERVICE_ACCOUNT_FILE, 'utf8');
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (j.client_email && j.private_key) return { client_email: j.client_email, private_key: j.private_key };
  } catch (e) { /* neispravan ključ se tretira kao nepodešen */ }
  return null;
}
const oauthAvailable = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);

function configured() {
  return propertyIds().length > 0 && (!!serviceAccount() || oauthAvailable());
}

let cached = { token: null, exp: 0 };
async function accessToken() {
  const sa = serviceAccount();
  if (!sa) return google.accessToken();
  if (cached.token && Date.now() < cached.exp - 60000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({ iss: sa.client_email, scope: SCOPE, aud: tokenUrl(), iat: now, exp: now + 3600 });
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
  const res = await fetch(tokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + sig }),
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* prazan odgovor */ }
  if (!res.ok || !json || !json.access_token) {
    throw new Error('Google OAuth (servisni nalog): ' + ((json && (json.error_description || json.error)) || 'HTTP ' + res.status));
  }
  cached = { token: json.access_token, exp: Date.now() + (toNum(json.expires_in) || 3600) * 1000 };
  return cached.token;
}

async function runReport(token, property, body) {
  const res = await fetch(`${base()}/${version()}/properties/${property}:runReport`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* prazan odgovor */ }
  if (!res.ok) {
    let msg = (json && json.error && json.error.message) || 'HTTP ' + res.status;
    if (/insufficient authentication scopes/i.test(msg)) msg += ' (ponovo pokrenite npm run google-auth da token dobije i Analytics dozvolu)';
    throw new Error('Google Analytics API: ' + msg);
  }
  return json;
}

async function pull(token, property, since, until, metrics, dimensionFilter) {
  const out = [];
  let offset = 0;
  for (let guard = 0; guard < 50; guard++) {
    const json = await runReport(token, property, {
      dateRanges: [{ startDate: since, endDate: until }],
      dimensions: DIMS.map((name) => ({ name })),
      metrics: metrics.map((name) => ({ name })),
      limit: '100000',
      offset: String(offset),
      ...(dimensionFilter ? { dimensionFilter } : {}),
    });
    const rows = json.rows || [];
    for (const r of rows) out.push({ dims: r.dimensionValues.map((v) => v.value), mets: r.metricValues.map((v) => toNum(v.value)) });
    offset += rows.length;
    if (!rows.length || offset >= toNum(json.rowCount)) break;
  }
  return out;
}

async function fetchProperty(property, since, until) {
  const token = await accessToken();
  const revenueMetric = process.env.GA4_REVENUE_METRIC || 'purchaseRevenue';
  const main = await pull(token, property, since, until, ['sessions', 'engagedSessions', 'keyEvents', revenueMetric]);

  // Opciono: broji samo jedan ključni događaj (npr. purchase ili generate_lead) umesto svih.
  const eventName = process.env.GA4_KEY_EVENT_NAME;
  let eventCounts = null;
  if (eventName) {
    const ev = await pull(token, property, since, until, ['eventCount'],
      { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: eventName } } });
    eventCounts = new Map(ev.map((r) => [r.dims.join('\u0000'), r.mets[0]]));
  }

  return main.map((r) => {
    const d = r.dims[0];
    return {
      date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
      source: (r.dims[1] || '(not set)').slice(0, 200),
      medium: (r.dims[2] || '(not set)').slice(0, 200),
      campaign: (r.dims[3] || '(not set)').slice(0, 300),
      sessions: r.mets[0],
      engaged: r.mets[1],
      keyEvents: eventCounts ? (eventCounts.get(r.dims.join('\u0000')) || 0) : r.mets[2],
      revenue: r.mets[3],
    };
  });
}

module.exports = { configured, propertyIds, fetchProperty };
