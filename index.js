// index.js — minimal Twilio reply check
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { MessagingResponse } = require('twilio').twiml;

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

const PORT = process.env.PORT || 3000;

app.get('/', (_req, res) => res.send('OK - minimal bot'));
app.all('/echo', (req, res) => res.json({ method: req.method, body: req.body, query: req.query }));

app.post('/whatsapp', (req, res) => {
  console.log('📩 Incoming', { from: req.body.From, body: req.body.Body, at: new Date().toISOString() });
  const twiml = new MessagingResponse();
  twiml.message('It works ✅');
  res.type('text/xml').send(twiml.toString());
});

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
