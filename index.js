// index.js
// Express + Twilio Webhook -> Airtable via REST (axios) + optional Sheets logging
require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { MessagingResponse } = require('twilio').twiml;

const app = express();

// Twilio form-encoded payloads
app.use(bodyParser.urlencoded({ extended: false }));

// ---------- ENV ----------
const PORT = process.env.PORT || 3000;

// Optional Sheets logging (Apps Script Web App)
const SHEETS_WEBAPP_URL = process.env.SHEETS_WEBAPP_URL || process.env.SHEETS_WEBAPP_URL?.trim();

// Airtable (must be provided to save in Airtable)
const AIRTABLE_API_KEY    = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID    = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || 'Orders';

// ---------- Helpers ----------
const nowISO = () => new Date().toISOString();

function parseOrderText(text) {
  const body = (text || '').trim();
  if (!body) return { item: '', qty: 1, address: '' };

  const simple = ['hi', 'hello', 'menu', 'start', 'urdu', 'english'];
  if (simple.includes(body.toLowerCase())) return { item: body, qty: 1, address: '' };

  const qtyMatch = body.match(/(^|\s)(\d+)(\s|$)/);
  const qty = qtyMatch ? parseInt(qtyMatch[2], 10) : 1;

  let address = '';
  const idx = body.toLowerCase().indexOf('address');
  if (idx !== -1) address = body.slice(idx + 7).trim().replace(/^[:\- ]+/, '');

  let item = body;
  if (qtyMatch) item = item.replace(qtyMatch[0], ' ');
  if (idx !== -1) item = item.slice(0, idx).trim();
  if (!item) item = 'Item';

  return { item, qty: isNaN(qty) ? 1 : qty, address };
}

async function saveToAirtable(fields) {
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID || !AIRTABLE_TABLE_NAME) {
    throw new Error('Airtable ENV missing (AIRTABLE_API_KEY / AIRTABLE_BASE_ID / AIRTABLE_TABLE_NAME)');
  }
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`;
  const payload = {
    records: [{ fields }],
    typecast: true // single-selects/choices کو خود fit کر دے
  };
  const headers = {
    Authorization: `Bearer ${AIRTABLE_API_KEY}`,
    'Content-Type': 'application/json'
  };
  const { data } = await axios.post(url, payload, { headers });
  const id = data?.records?.[0]?.id;
  return id;
}

async function optionalLogToSheets(row) {
  if (!SHEETS_WEBAPP_URL) return;
  try {
    await axios.post(SHEETS_WEBAPP_URL, row);
  } catch (e) {
    console.warn('Sheets logging failed (ignored):', e?.message || String(e));
  }
}

// ---------- Health / Debug ----------
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    env: {
      AIRTABLE_API_KEY: !!AIRTABLE_API_KEY,
      AIRTABLE_BASE_ID: !!AIRTABLE_BASE_ID,
      AIRTABLE_TABLE_NAME: AIRTABLE_TABLE_NAME,
      SHEETS_WEBAPP_URL: !!SHEETS_WEBAPP_URL
    }
  });
});

// Direct test without Twilio (open in browser)
app.get('/airtable-test', async (req, res) => {
  try {
    const fields = {
      'Phone Number': '+61000000000',
      'Order Item'  : 'Test Item',
      'Quantity'    : 1,
      'Address'     : 'Test Address',
      'Status'      : 'Pending',
      'Order Time'  : nowISO()
    };
    const id = await saveToAirtable(fields);
    res.json({ success: true, id });
  } catch (e) {
    console.error('Airtable TEST error:', e?.response?.data || e?.message || String(e));
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

// ---------- Twilio WhatsApp Webhook ----------
app.post('/whatsapp', async (req, res) => {
  const twiml = new MessagingResponse();

  try {
    const fromRaw = req.body.From || '';           // 'whatsapp:+61xxxx'
    const from = fromRaw.replace('whatsapp:', ''); // '+61xxxx'
    const body = req.body.Body || '';

    const { item, qty, address } = parseOrderText(body);

    const fields = {
      'Phone Number': from,
      'Order Item'  : item,
      'Quantity'    : qty,
      'Address'     : address,
      'Status'      : 'Pending',
      'Order Time'  : nowISO()
    };

    // Save to Airtable (if keys provided)
    let recId = '';
    try {
      recId = await saveToAirtable(fields);
      console.log('✅ Airtable record created:', recId, fields);
    } catch (err) {
      console.error('❌ Airtable create error:', err?.response?.data || err?.message || String(err));
      // We still reply to user; also try optional Sheets logging
    }

    await optionalLogToSheets({ ...fields, recordId: recId });

    const reply =
      `✅ محفوظ ہو گیا!\n• نمبر: ${from}\n• آئٹم: ${item}\n• مقدار: ${qty}\n` +
      (address ? `• ایڈریس: ${address}\n` : '') +
      `اسٹیٹس: Pending`;
    twiml.message(reply);
    res.type('text/xml').send(twiml.toString());
  } catch (e) {
    console.error('Webhook error:', e?.message || String(e));
    const tw = new MessagingResponse();
    tw.message('⚠️ اس وقت ریکارڈ محفوظ نہیں ہو سکا۔ بعد میں دوبارہ کوشش کریں۔');
    res.type('text/xml').send(tw.toString());
  }
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
