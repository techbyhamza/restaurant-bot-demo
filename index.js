// index.js — Multi-restaurant WhatsApp bot (fast reply) + Airtable via axios
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { MessagingResponse } = require('twilio').twiml;

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

const PORT = process.env.PORT || 3000;

// Airtable ENV (supports AIRTABLE_API_KEY or AIRTABLE_PAT)
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_PAT;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || 'Orders';

// In-memory sessions: { phone: { step, data } }
const sessions = {};

// Menus
const MENUS = {
  'Al Noor Pizza': ['Margherita', 'Pepperoni', 'BBQ Chicken'],
  'First Choice': ['Zinger Burger', 'Shawarma', 'Club Sandwich']
};

// Util
const nowISO = () => new Date().toISOString();
const reply = (res, msg) => {
  const tw = new MessagingResponse();
  tw.message(msg);
  res.type('text/xml').send(tw.toString());
};

// Background Airtable save (never blocks reply)
function saveToAirtableBkg(fields) {
  try {
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID || !AIRTABLE_TABLE_NAME) {
      console.warn('Airtable ENV missing; skip save');
      return;
    }
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`;
    const headers = { Authorization: `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' };
    const payload = { records: [{ fields }], typecast: true };

    // fire-and-forget
    axios.post(url, payload, { headers, timeout: 4000 })
      .then(r => console.log('✅ Airtable saved:', r.data?.records?.[0]?.id, fields))
      .catch(e => console.error('❌ Airtable save error:', e?.response?.data || e.message));
  } catch (e) {
    console.error('Airtable save exception:', e.message);
  }
}

// Health & echo
app.get('/', (_req, res) => res.send('OK - multi-restaurant bot running'));
app.get('/health', (_req, res) => res.json({
  ok: true,
  env: {
    AIRTABLE_API_KEY: !!AIRTABLE_API_KEY,
    AIRTABLE_BASE_ID: !!AIRTABLE_BASE_ID,
    AIRTABLE_TABLE_NAME: AIRTABLE_TABLE_NAME
  }
}));
app.all('/echo', (req, res) => res.json({ method: req.method, body: req.body, query: req.query }));

// WhatsApp webhook
app.post('/whatsapp', (req, res) => {
  const from = (req.body.From || '').replace('whatsapp:', '');
  const text = (req.body.Body || '').trim();
  console.log('📩', { from, text, at: nowISO() });

  // ensure session
  if (!sessions[from]) sessions[from] = { step: 'welcome', data: {} };
  const s = sessions[from];

  try {
    // STEP: welcome
    if (s.step === 'welcome') {
      s.step = 'restaurant';
      return reply(res,
        '👋 خوش آمدید! براہِ کرم ریسٹورنٹ منتخب کریں:\n' +
        '1️⃣ Al Noor Pizza\n2️⃣ First Choice'
      );
    }

    // STEP: restaurant
    if (s.step === 'restaurant') {
      const t = text.toLowerCase();
      if (t === '1' || t.includes('al') || t.includes('noor')) s.data.restaurant = 'Al Noor Pizza';
      else if (t === '2' || t.includes('first') || t.includes('choice')) s.data.restaurant = 'First Choice';
      else return reply(res, 'براہ کرم 1 یا 2 منتخب کریں۔');

      const menu = MENUS[s.data.restaurant].map((x, i) => `${i + 1}. ${x}`).join('\n');
      s.step = 'menu';
      return reply(res, `🍽 آپ نے منتخب کیا: ${s.data.restaurant}\n\nMenu:\n${menu}\n\nبراہ کرم آئٹم نمبر بھیجیں۔`);
    }

    // STEP: menu
    if (s.step === 'menu') {
      const list = MENUS[s.data.restaurant] || [];
      const idx = parseInt(text, 10);
      if (isNaN(idx) || idx < 1 || idx > list.length) return reply(res, 'براہ کرم درست آئٹم نمبر منتخب کریں۔');
      s.data.item = list[idx - 1];
      s.step = 'quantity';
      return reply(res, `آپ نے منتخب کیا: ${s.data.item}\nکتنی quantity چاہیے؟`);
    }

    // STEP: quantity
    if (s.step === 'quantity') {
      const qty = parseInt(text, 10);
      if (isNaN(qty) || qty < 1) return reply(res, 'براہ کرم درست quantity لکھیں (مثال: 2)');
      s.data.quantity = qty;
      s.step = 'dining';
      return reply(res, 'کیا آپ dine-in کریں گے، takeaway یا booking؟');
    }

    // STEP: dining
    if (s.step === 'dining') {
      const t = text.toLowerCase();
      if (!['dine-in', 'takeaway', 'booking'].includes(t)) {
        return reply(res, "براہ کرم 'dine-in' یا 'takeaway' یا 'booking' لکھیں۔");
      }
      s.data.dining = t;
      s.step = 'payment';
      return reply(res, 'ادائیگی کا طریقہ منتخب کریں:\n1. Pay at Counter\n2. Cash on Delivery\n3. Online Payment');
    }

    // STEP: payment -> save + confirm
    if (s.step === 'payment') {
      const t = text.toLowerCase();
      if (['1', 'pay', 'counter'].includes(t)) s.data.payment = 'Pay at Counter';
      else if (['2', 'cash', 'delivery'].includes(t)) s.data.payment = 'Cash on Delivery';
      else if (['3', 'online'].includes(t)) s.data.payment = 'Online Payment';
      else return reply(res, 'براہ کرم 1، 2 یا 3 منتخب کریں۔');

      // background save
      const fields = {
        'Phone Number': from,
        'Restaurant': s.data.restaurant,
        'Order Item': s.data.item,
        'Quantity': s.data.quantity,
        'Dining': s.data.dining,
        'Payment': s.data.payment,
        'Status': 'Pending',
        'Order Time': nowISO()
      };
      saveToAirtableBkg(fields);

      const confirm =
        `✅ آپ کا آرڈر کنفرم ہوگیا!\n\n` +
        `📍 ریسٹورنٹ: ${s.data.restaurant}\n` +
        `🍽 آئٹم: ${s.data.item}\n` +
        `🔢 Quantity: ${s.data.quantity}\n` +
        `🏠 Mode: ${s.data.dining}\n` +
        `💳 Payment: ${s.data.payment}\n\n` +
        `شکریہ!`;
      delete sessions[from];
      return reply(res, confirm);
    }

    // fallback
    sessions[from] = { step: 'welcome', data: {} };
    return reply(res, '👋 Welcome! Reply "Hi" to start.');
  } catch (err) {
    console.error('🚨 Handler error:', err?.stack || err?.message);
    return reply(res, '⚠️ عارضی مسئلہ—براہ کرم دوبارہ کوشش کریں۔');
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
