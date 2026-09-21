'use strict';
// Ulazna tačka za Vercel (zero-config Express): Vercel prepoznaje Express aplikaciju iz ovog fajla
// i pokreće je kao jednu funkciju. Statički fajlovi iz foldera public/ servira Vercel CDN.
const express = require('express');
const { createApp } = require('./lib/app');

const app = express();
app.use(createApp());

module.exports = app;
