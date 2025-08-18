// index.js — WhatsApp bot (failsafe), Express + Twilio + Axios (Airtable REST)
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { MessagingResponse } = require('twilio').twiml;

const app = express();

// Twilio form-encoded payloads
app.use(bodyParser.urlencoded({ extended: false }));

// ----- ENV -----
const PORT = process.env.PORT || 3000;
const SAFE_MODE = process.env.SAFE_MODE === '1'; // 1 => Airtable off (for testing)

const AIRTABLE_API_KEY    = process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_PAT;
const AIRTABLE_BASE_ID    = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || 'Orders';

// ----- In-memory sessions -----
const sessions = {};

// ----- Menus -----
const MENUS = {
  'Al Noor Pizza': ['Margherita', 'Pepperoni', 'BBQ Chicken'],
  'First Choice': ['Zinger Burger', 'Shawarma', 'Club Sandwich']
};

// ----- Helpers -----
const nowISO = () => new Date().toISOString();

function parseChoice(text) {
  return (text || '').trim().toLowerCase();
}

function startSession(phone) {
  sessions[phone] = { step: 'welcome', data: {} };
  return sessions[phone];
}

// Airtable save with 4s timeout so reply never blocks
async function saveToAirtable(fields) {
  if (SAFE_MODE) return 'safe_mode_skipped';
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID || !AIRTABLE_TABLE_NAME) {
    throw new Error('Airtable ENV missing (AIRTABLE_API_KEY / AIRTABLE_BASE_ID / AIRTABLE_TABLE_NAME)');
  }
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`;
  const headers = {
    Authorization: `Bearer ${AIRTABLE_API_KEY}`,
    'Content-Type': 'application/json'
  };
  const payload = { records: [{ fields }], typecast: true };

  // timeout wrapper (4s)
  const req = axios.post(url, payload, { headers });
  const to = new Promise((_, rej) => setTimeout(() => rej(new Error('Airtable timeout')), 4000));
  const res = await Promise.race([req, to]);
  return res?.data?.records?.[0]?.id || 'created';
}

// ----- Sanity routes -----
app.get('/', (_req, res) => res.send('OK - WhatsApp bot running'));
app.get('/health', (_req, res) =>
  res.json({
    ok: true,
    safe_mode: SAFE_MODE,
    env: {
      AIRTABLE_API_KEY: !!AIRTABLE_API_KEY,
      AIRTABLE_BASE_ID: !!AIRTABLE_BASE_ID,
      AIRTABLE_TABLE_NAME: AIRTABLE_TABLE_NAME
    }
  })
);
// Quick echo to see body reaching server (POST or GET)
app.all('/echo', (req, res) => res.json({ method: req.method, body: req.body, query: req.query }));

// ----- WhatsApp webhook -----
app.post('/whatsapp', async (req, res) => {
  const from = (req.body.From || '').replace('whatsapp:', '');
  const text = (req.body.Body || '').trim();
  console.log('📩 Incoming:', { from, text, at: new Date().toISOString() });

  // Always prepare Twilio response (we'll send no matter what)
  const twiml = new MessagingResponse();

  try {
    // Start / resume session
    const session = sessions[from] || startSession(from);

    if (session.step === 'welcome') {
      twiml.message(
        '👋 خوش آمدید! براہِ کرم ریسٹورنٹ منتخب کریں:\n' +
        '1️⃣ Al Noor Pizza\n2️⃣ First Choice'
      );
      session.step = 'restaurant';
      return res.type('text/xml').send(twiml.toString());
    }

    if (session.step === 'restaurant') {
      const t = parseChoice(text);
      if (t === '1' || t.includes('al') || t.includes('noor')) {
        session.data.restaurant = 'Al Noor Pizza';
      } else if (t === '2' || t.includes('first') || t.includes('choice')) {
        session.data.restaurant = 'First Choice';
      } else {
        twiml.message('براہ کرم 1 یا 2 منتخب کریں۔');
        return res.type('text/xml').send(twiml.toString());
      }
      const menu = MENUS[session.data.restaurant].map((x, i) => `${i + 1}. ${x}`).join('\n');
      twiml.message(`🍽 آپ نے منتخب کیا: ${session.data.restaurant}\n\nMenu:\n${menu}\n\nبراہ کرم آئٹم نمبر بھیجیں۔`);
      session.step = 'menu';
      return res.type('text/xml').send(twiml.toString());
    }

    if (session.step === 'menu') {
      const list = MENUS[session.data.restaurant] || [];
      const idx = parseInt(text, 10);
      if (isNaN(idx) || idx < 1 || idx > list.length) {
        twiml.message('براہ کرم درست آئٹم نمبر منتخب کریں۔');
        return res.type('text/xml').send(twiml.toString());
      }
      session.data.item = list[idx - 1];
      twiml.message(`آپ نے منتخب کیا: ${session.data.item}\nکتنی quantity چاہیے؟`);
      session.step = 'quantity';
      return res.type('text/xml').send(twiml.toString());
    }

    if (session.step === 'quantity') {
      const qty = parseInt(text, 10);
      if (isNaN(qty) || qty < 1) {
        twiml.message('براہ کرم درست quantity لکھیں (مثال: 2)');
        return res.type('text/xml').send(twiml.toString());
      }
      session.data.quantity = qty;
      twiml.message('کیا آپ dine-in کریں گے، takeaway یا booking؟');
      session.step = 'dining';
      return res.type('text/xml').send(twiml.toString());
    }

    if (session.step === 'dining') {
      const t = parseChoice(text);
      if (!['dine-in', 'takeaway', 'booking'].includes(t)) {
        twiml.message("براہ کرم 'dine-in' یا 'takeaway' یا 'booking' لکھیں۔");
        return res.type('text/xml').send(twiml.toString());
      }
      session.data.dining = t;
      twiml.message('ادائیگی کا طریقہ منتخب کریں:\n1. Pay at Counter\n2. Cash on Delivery\n3. Online Payment');
      session.step = 'payment';
      return res.type('text/xml').send(twiml.toString());
    }

    if (session.step === 'payment') {
      const t = parseChoice(text);
      if (['1', 'pay', 'counter'].includes(t)) session.data.payment = 'Pay at Counter';
      else if (['2', 'cash', 'delivery'].includes(t)) session.data.payment = 'Cash on Delivery';
      else if (['3', 'online'].includes(t)) session.data.payment = 'Online Payment';
      else {
        twiml.message('براہ کرم 1، 2 یا 3 منتخب کریں۔');
        return res.type('text/xml').send(twiml.toString());
      }

      // Save (non-blocking for reply speed)
      const fields = {
        'Phone Number': from,
        'Restaurant': session.data.restaurant,
        'Order Item': session.data.item,
        'Quantity': session.data.quantity,
        'Dining': session.data.dining,
        'Payment': session.data.payment,
        'Status': 'Pending',
        'Order Time': nowISO()
      };
      saveToAirtable(fields).then(id => {
        console.log('✅ Airtable saved:', id, fields);
      }).catch(err => {
        console.error('❌ Airtable save error:', err?.response?.data || err.message || String(err));
      });

      twiml.message(
        `✅ آپ کا آرڈر کنفرم ہوگیا!\n\n` +
        `📍 ریسٹورنٹ: ${session.data.restaurant}\n` +
        `🍽 آئٹم: ${session.data.item}\n` +
        `🔢 Quantity: ${session.data.quantity}\n` +
        `🏠 Mode: ${session.data.dining}\n` +
        `💳 Payment: ${session.data.payment}\n\n` +
        `شکریہ!`
      );
      delete sessions[from];
      return res.type('text/xml').send(twiml.toString());
    }

    // fallback (shouldn't reach)
    twiml.message('👋 Welcome! Reply "Hi" to start.');
    return res.type('text/xml').send(twiml.toString());
  } catch (err) {
    // Never leave Twilio hanging—always reply
    console.error('🚨 Webhook handler error:', err?.stack || err?.message || String(err));
    const fail = new MessagingResponse();
    fail.message('⚠️ عارضی مسئلہ—براہ کرم دوبارہ کوشش کریں۔');
    return res.type('text/xml').send(fail.toString());
  }
});

// ----- Start -----
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
