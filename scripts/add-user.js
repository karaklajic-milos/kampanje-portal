'use strict';
// Rezerva ako se ne možete prijaviti: npm run add-user -- email@primer.rs "duga-lozinka" [admin|viewer]
// Zahteva DATABASE_URL u .env fajlu. Inače korisnike dodajete iz portala (odeljak Korisnici).
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../lib/db');

(async () => {
  const [email, password, role = 'viewer'] = process.argv.slice(2);
  if (!email || !password || !['admin', 'viewer'].includes(role)) throw new Error('Upotreba: npm run add-user -- email lozinka [admin|viewer]');
  if (password.length < 10) throw new Error('Lozinka mora imati bar 10 znakova.');
  await db.ensureSchema();
  await db.saveUser(email, bcrypt.hashSync(password, 12), role);
  console.log(`Sačuvan korisnik ${email.toLowerCase()} (${role}).`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
