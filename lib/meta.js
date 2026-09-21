'use strict';
// Meta Marketing API (Instagram oglasi) — Insights po kampanji i danu.
// Autentikacija: System User token iz Meta Business Settings (ne ističe), dozvola ads_read.
const { toNum } = require('./util');

const base = () => process.env.META_BASE_URL || 'https://graph.facebook.com';
const version = () => process.env.META_API_VERSION || 'v25.0';

function accountIds() {
  return (process.env.META_AD_ACCOUNT_IDS || '')
    .split(',').map((s) => s.trim()).filter(Boolean)
    .map((s) => (s.startsWith('act_') ? s : 'act_' + s.replace(/\D/g, '')));
}
function configured() {
  return !!(process.env.META_ACCESS_TOKEN && accountIds().length);
}

function sumActions(list, types) {
  if (!Array.isArray(list)) return 0;
  let t = 0;
  for (const a of list) if (types.includes(a.action_type)) t += toNum(a.value);
  return t;
}

async function getJson(url) {
  const res = await fetch(url);
  let json = null;
  try { json = await res.json(); } catch (e) { /* prazan odgovor */ }
  if (!res.ok || (json && json.error)) {
    const msg = json && json.error ? json.error.message : 'HTTP ' + res.status;
    throw new Error('Meta API: ' + msg);
  }
  return json;
}

async function fetchAccount(account, since, until) {
  const onlyInstagram = (process.env.META_ONLY_INSTAGRAM || 'true') !== 'false';
  const clicksField = process.env.META_CLICKS_FIELD || 'inline_link_clicks';
  const convTypes = (process.env.META_CONVERSION_ACTION || 'purchase').split(',').map((s) => s.trim()).filter(Boolean);
  const revTypes = (process.env.META_REVENUE_ACTION || process.env.META_CONVERSION_ACTION || 'purchase').split(',').map((s) => s.trim()).filter(Boolean);

  const params = new URLSearchParams({
    level: 'campaign',
    fields: ['campaign_name', 'spend', 'impressions', clicksField, 'actions', 'action_values'].join(','),
    time_increment: '1',
    time_range: JSON.stringify({ since, until }),
    breakdowns: 'publisher_platform',
    limit: '500',
    access_token: process.env.META_ACCESS_TOKEN,
  });

  let url = `${base()}/${version()}/${account}/insights?${params}`;
  const rows = [];
  let guard = 0;
  while (url && guard++ < 200) {
    const json = await getJson(url);
    for (const r of json.data || []) {
      if (onlyInstagram && r.publisher_platform !== 'instagram') continue;
      rows.push({
        campaign: r.campaign_name || '(bez naziva)',
        date: r.date_start,
        spend: toNum(r.spend),
        impressions: toNum(r.impressions),
        clicks: toNum(r[clicksField]),
        conversions: sumActions(r.actions, convTypes),
        revenue: sumActions(r.action_values, revTypes),
      });
    }
    url = json.paging && json.paging.next ? json.paging.next : null;
  }
  return rows;
}

module.exports = { configured, accountIds, fetchAccount };
