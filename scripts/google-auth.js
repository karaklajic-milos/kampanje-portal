'use strict';
// Jednokratno dobijanje Google OAuth refresh tokena za Google Ads API.
// Pokrenite lokalno (na svom računaru): npm run google-auth
// Token dobija dozvolu za Google Ads i za čitanje Google Analytics podataka.
// Potrebni su GOOGLE_CLIENT_ID i GOOGLE_CLIENT_SECRET (OAuth klijent tipa "Desktop app").
require('dotenv').config();
const http = require('http');

const id = process.env.GOOGLE_CLIENT_ID;
const secret = process.env.GOOGLE_CLIENT_SECRET;
if (!id || !secret) {
  console.error('Upišite GOOGLE_CLIENT_ID i GOOGLE_CLIENT_SECRET u .env pa pokrenite ponovo.');
  process.exit(1);
}

const PORT = 53682;
const redirect = `http://127.0.0.1:${PORT}/callback`;
const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: id, redirect_uri: redirect, response_type: 'code',
  scope: 'https://www.googleapis.com/auth/adwords https://www.googleapis.com/auth/analytics.readonly', access_type: 'offline', prompt: 'consent',
});

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, redirect);
  if (u.pathname !== '/callback') { res.writeHead(404).end(); return; }
  const code = u.searchParams.get('code');
  if (!code) { res.writeHead(400).end('Nedostaje kod.'); return; }
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: redirect, grant_type: 'authorization_code' }),
    });
    const j = await r.json();
    if (!j.refresh_token) throw new Error(j.error_description || j.error || 'Google nije vratio refresh token.');
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Gotovo. Vratite se u terminal.');
    console.log('\nUpišite u .env na serveru:\n\nGOOGLE_REFRESH_TOKEN=' + j.refresh_token + '\n');
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Greška: ' + e.message);
    console.error('Greška:', e.message);
  }
  server.close();
});
server.listen(PORT, '127.0.0.1', () => {
  console.log('Otvorite ovaj link u pregledaču i odobrite pristup:\n\n' + url + '\n');
});
