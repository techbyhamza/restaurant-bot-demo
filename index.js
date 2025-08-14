// index.js — WhatsApp restaurant bot (Twilio webhook)
// Requirements: express, axios, dotenv, body-parser (یا express.urlencoded), twilio

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { twiml: { MessagingResponse } } = require('twilio');

const app = express();

// Twilio WhatsApp webhooks send x-www-form-urlencoded
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ----- ENV -----
const PORT = process.env.PORT || 3000;
const SHEETS_WEBAPP_URL = process.env.SHEETS_WEBAPP_URL || ""; // <-- Apps Script Web App (/exec) URL ضروری

// ----- Simple session store (in-memory) -----
const sessions = new Map(); // key = phone, value = state bag

function getSession(key) {
  if (!sessions.has(key)) {
    sessions.set(key, {
      state: 'LANG',          // LANG -> MENU -> QTY -> ADDRESS -> PAYMENT -> CONFIRM
      lang: 'EN',
      itemCode: '',
      qty: 1,
      address: '',
      payment: '',
      orderId: '',
      customerName: ''
    });
  }
  return sessions.get(key);
}

// ----- Menu -----
const MENU = {
  B1K: { name: 'Burger (Single)', price: 8 },
  B2:  { name: 'Double Burger',  price: 12 },
  DS2: { name: 'Ice Cream Cup',  price: 4 },
};

function menuText() {
  return [
    'First Choice Foods — Menu',
    'Send item code (e.g., B1K)',
    `• B1K — ${MENU.B1K.name} ($${MENU.B1K.price})`,
    `• B2 —  ${MENU.B2.name} ($${MENU.B2.price})`,
    `• DS2 — ${MENU.DS2.name} ($${MENU.DS2.price})`,
    '',
    "Use 'back' or 'reset'."
  ].join('\n');
}

// ----- Helpers -----
function reply(res, text) {
  const m = new MessagingResponse();
  m.message(text);
  res.type('text/xml');
  return res.send(m.toString());
}

function normalize(bodyText) {
  const raw = (bodyText || '').trim();
  const singleSp = raw.replace(/\s+/g, ' ');
  return { raw, text: singleSp, upper: singleSp.toUpperCase() };
}

async function logToSheet(payload) {
  if (!SHEETS_WEBAPP_URL) return { ok: false, error: 'Missing SHEETS_WEBAPP_URL' };
  try {
    const { data } = await axios.post(SHEETS_WEBAPP_URL, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err?.response?.data || err.message };
  }
}

function resetSession(s) {
  s.state = 'LANG';
  s.lang = 'EN';
  s.itemCode = '';
  s.qty = 1;
  s.address = '';
  s.payment = '';
  s.orderId = '';
  s.customerName = '';
}

// ----- WhatsApp webhook -----
app.post('/whatsapp', async (req, res) => {
  const from = req.body.From || 'unknown';
  const s = getSession(from);

  const { raw, text, upper } = normalize(req.body.Body);

  // shortcuts
  if (upper === 'RESET') { resetSession(s); return reply(res, "Session reset. Type 'hi' to start."); }
  if (upper === 'BACK') {
    if (s.state === 'QTY') s.state = 'MENU';
    else if (s.state === 'ADDRESS') s.state = 'QTY';
    else if (s.state === 'PAYMENT') s.state = 'ADDRESS';
    else if (s.state === 'CONFIRM') s.state = 'PAYMENT';
    return reply(res, `Went back. Current step: ${s.state}.`);
  }

  console.log(`[${from}] state=${s.state} msg="${raw}" item=${s.itemCode||'-'} qty=${s.qty||'-'}`);

  // ---- Flow ----
  if (upper === 'HI' || s.state === 'LANG') {
    s.state = 'LANG';
    return reply(res, "Hi! Choose language:\n1) Urdu\n2) English\n\nSend the number of your choice.");
  }

  if (s.state === 'LANG') {
    if (upper === '1') { s.lang = 'UR'; s.state = 'MENU'; return reply(res, menuText()); }
    if (upper === '2') { s.lang = 'EN'; s.state = 'MENU'; return reply(res, menuText()); }
    return reply(res, "Please send 1 (Urdu) or 2 (English).");
  }

  if (s.state === 'MENU') {
    if (MENU[upper]) {
      s.itemCode = upper;
      s.state = 'QTY';
      return reply(res, `✔️ ${MENU[upper].name} selected.\nPlease send quantity (1–20).`);
    }
    return reply(res, menuText());
  }

  if (s.state === 'QTY') {
    const q = parseInt(upper, 10);
    if (!Number.isFinite(q) || q <= 0 || q > 20) {
      return reply(res, 'Please send a valid quantity (e.g., 1, 2).');
    }
    s.qty = q;
    s.state = 'ADDRESS';
    return reply(res, `Quantity: ${q}\nSend delivery address:`);
  }

  if (s.state === 'ADDRESS') {
    if (text.length < 4) return reply(res, 'Please send a proper address.');
    s.address = text;
    s.state = 'PAYMENT';
    return reply(res, "Payment method?\n1) Cash on Delivery\n2) Card on Arrival\n3) Online (Paid)");
  }

  if (s.state === 'PAYMENT') {
    if (!['1','2','3'].includes(upper)) {
      return reply(res, "Please choose 1, 2, or 3:\n1) Cash on Delivery\n2) Card on Arrival\n3) Online (Paid)");
    }
    s.payment = (upper === '1') ? 'Cash on Delivery' : (upper === '2') ? 'Card on Arrival' : 'Online (Paid)';
    s.state = 'CONFIRM';

    const item = MENU[s.itemCode];
    const total = item.price * s.qty;
    const summary = [
      `Please type 'yes' to confirm, or 'back/reset'.`,
      '',
      `Item: ${item.name} (${s.itemCode})`,
      `Qty: ${s.qty}`,
      `Address: ${s.address}`,
      `Payment: ${s.payment}`,
      `Total: $${total}`
    ].join('\n');
    return reply(res, summary);
  }

  if (s.state === 'CONFIRM') {
    if (upper !== 'YES') return reply(res, "Type 'yes' to confirm, or 'back/reset'.");

    // Build order payload
    const nowId = Date.now().toString().slice(-6);
    s.orderId = `ORD-${nowId}`;
    const item = MENU[s.itemCode];
    const payload = {
      orderId: s.orderId,
      customerName: req.body.ProfileName || '',  // Twilio may pass profile name
      phoneNumber: from,
      orderDetails: `${item.name} (${s.itemCode}) x ${s.qty} — $${item.price * s.qty}`,
      quantity: s.qty,
      deliveryAddress: s.address,
      paymentMethod: s.payment
    };

    // Log to Google Sheet
    const result = await logToSheet(payload);
    console.log('Sheets response:', result);

    resetSession(s);
    if (result.ok) {
      return reply(res, "Thanks! Your request has been sent. Type 'hi' to start again.");
    } else {
      return reply(res, `Order received but logging failed: ${result.error}\nType 'hi' to start again.`);
    }
  }

  // default fallback
  return reply(res, "Type 'hi' to start.");
});

// Health check
app.get('/', (_req, res) => res.send('OK'));

app.listen(PORT, () => {
  console.log('Server running on', PORT);
});
