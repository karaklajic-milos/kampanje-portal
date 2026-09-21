'use strict';
// Google Ads API (REST) — kampanje po danu preko GAQL upita.
// Autentikacija: OAuth refresh token + developer token (+ opciono login-customer-id za MCC nalog).
const { toNum } = require('./util');

const adsBase = () => process.env.GOOGLE_ADS_BASE_URL || 'https://googleads.googleapis.com';
const tokenUrl = () => process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const version = () => process.env.GOOGLE_ADS_API_VERSION || 'v25';

const digits = (s) => String(s || '').replace(/\D/g, '');

function customerIds() {
  return (process.env.GOOGLE_ADS_CUSTOMER_IDS || '').split(',').map(digits).filter(Boolean);
}
function configured() {
  return !!(process.env.GOOGLE_ADS_DEVELOPER_TOKEN && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN && customerIds().length);
}

let cached = { token: null, exp: 0 };
async function accessToken() {
  if (cached.token && Date.now() < cached.exp - 60000) return cached.token;
  const res = await fetch(tokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* prazan odgovor */ }
  if (!res.ok || !json || !json.access_token) {
    throw new Error('Google OAuth: ' + ((json && (json.error_description || json.error)) || 'HTTP ' + res.status));
  }
  cached = { token: json.access_token, exp: Date.now() + (toNum(json.expires_in) || 3600) * 1000 };
  return cached.token;
}

function errorMessage(json, status) {
  const e = Array.isArray(json) ? json[0] && json[0].error : json && json.error;
  if (e && e.message) return e.message;
  return 'HTTP ' + status;
}

async function fetchAccount(customerId, since, until) {
  const query = `SELECT campaign.name, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value
FROM campaign WHERE segments.date BETWEEN '${since}' AND '${until}'`;

  const headers = {
    Authorization: 'Bearer ' + (await accessToken()),
    'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    'Content-Type': 'application/json',
  };
  const login = digits(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  if (login) headers['login-customer-id'] = login;

  const res = await fetch(`${adsBase()}/${version()}/customers/${customerId}/googleAds:searchStream`, {
    method: 'POST', headers, body: JSON.stringify({ query }),
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* prazan odgovor */ }
  if (!res.ok) throw new Error('Google Ads API: ' + errorMessage(json, res.status));

  const rows = [];
  for (const batch of Array.isArray(json) ? json : [json]) {
    for (const r of (batch && batch.results) || []) {
      rows.push({
        campaign: (r.campaign && r.campaign.name) || '(bez naziva)',
        date: r.segments && r.segments.date,
        spend: toNum(r.metrics && r.metrics.costMicros) / 1e6,
        impressions: toNum(r.metrics && r.metrics.impressions),
        clicks: toNum(r.metrics && r.metrics.clicks),
        conversions: toNum(r.metrics && r.metrics.conversions),
        revenue: toNum(r.metrics && r.metrics.conversionsValue),
      });
    }
  }
  return rows.filter((r) => r.date);
}

module.exports = { configured, customerIds, fetchAccount, accessToken };
