'use strict';
// Lokalni razvoj: npm run dev (čita .env, koristi DATABASE_URL). Na Vercelu se ne koristi.
const { createApp, ensureReady } = require('./lib/app');

const port = parseInt(process.env.PORT, 10) || 3000;
ensureReady()
  .then(() => createApp().listen(port, () => console.log('Portal radi na http://localhost:' + port)))
  .catch((e) => { console.error('Greška pri pokretanju:', e.message); process.exit(1); });
