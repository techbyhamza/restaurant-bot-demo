// index.js — Minimal WhatsApp Order Bot (Twilio)
// deps: express, axios, dotenv, twilio

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { twiml: { MessagingResponse } } = require('twilio');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ---- ENV ----
const PORT = process.env.PORT || 3000;
const SHEETS_WEBAPP_URL = process.env.SHEETS_WEBAPP_URL || ""; // <-- your Apps Script /exec URL

// ---- In-memory sessions ----
const S = new Map();
const getS = (k) => (S.has(k) ? S.get(k) : S.set(k, {
  state: 'LANG', lang: 'EN', item: '', qty: 1, addr: '', pay: ''
}).get(k));
const resetS = (s) => { s.state='LANG'; s.lang='EN'; s.item=''; s.qty=1; s.addr=''; s.pay=''; };

// ---- Test Menu (3 items) ----
const MENU = {
  B1K: { name: 'Burger (Single)', price: 8 },
  B2 : { name: 'Double Burger',   price: 12 },
  DS2: { name: 'Ice Cream Cup',   price: 4 }
};
const menuText = () => [
  'First Choice Foods — Menu',
  'Send item code (e.g., B1K)',
  `• B1K — ${MENU.B1K.name} ($${MENU.B1K.price})`,
  `• B2 —  ${MENU.B2.name} ($${MENU.B2.price})`,
  `• DS2 — ${MENU.DS2.name} ($${MENU.DS2.price})`,
  '',
  "Use 'back' or 'reset'."
].join('\n');

const reply = (res, text) => {
  const m = new MessagingResponse(); m.message(text);
  res.type('text/xml'); return res.send(m.toString());
};
const norm = (t) => {
  const raw = (t || '').trim();
  const text = raw.replace(/\s+/g, ' ');
  return { raw, text, up: text.toUpperCase() };
};

async function sendToSheet(payload){
  if(!SHEETS_WEBAPP_URL) return { ok:false, error:'Missing SHEETS_WEBAPP_URL' };
  try{
    const { data } = await axios.post(SHEETS_WEBAPP_URL, payload, {
      headers:{'Content-Type':'application/json'}, timeout:10000
    });
    return { ok:true, data };
  }catch(e){
    return { ok:false, error: e?.response?.data || e.message };
  }
}

app.post('/whatsapp', async (req, res) => {
  const from = req.body.From || 'unknown';
  const s = getS(from);
  const { raw, text, up } = norm(req.body.Body);

  // shortcuts
  if (up === 'RESET') { resetS(s); return reply(res, "Session reset. Type 'hi' to start."); }
  if (up === 'BACK') {
    s.state = (s.state==='QTY')?'MENU': (s.state==='ADDRESS')?'QTY'
            : (s.state==='PAYMENT')?'ADDRESS': (s.state==='CONFIRM')?'PAYMENT':'LANG';
    return reply(res, `Went back. Step: ${s.state}.`);
  }

  console.log(`[${from}] state=${s.state} msg="${raw}"`);

  // Only "hi" shows language screen
  if (up === 'HI') {
    s.state = 'LANG';
    return reply(res, "Hi! Choose language:\n1) Urdu\n2) English\n\nSend the number of your choice.");
  }

  // 1) Language
  if (s.state === 'LANG') {
    if (up === '1'){ s.lang='UR'; s.state='MENU'; return reply(res, menuText()); }
    if (up === '2'){ s.lang='EN'; s.state='MENU'; return reply(res, menuText()); }
    return reply(res, "Please send 1 (Urdu) or 2 (English).");
  }

  // 2) Menu
  if (s.state === 'MENU') {
    if (MENU[up]) { s.item = up; s.state='QTY'; return reply(res, `✔️ ${MENU[up].name} selected.\nSend quantity (1–20).`); }
    return reply(res, menuText());
  }

  // 3) Quantity
  if (s.state === 'QTY') {
    const q = parseInt(up, 10);
    if (!Number.isFinite(q) || q<=0 || q>20) return reply(res, 'Please send a valid quantity (e.g., 1, 2).');
    s.qty = q; s.state='ADDRESS';
    return reply(res, `Quantity: ${q}\nSend delivery address:`);
  }

  // 4) Address
  if (s.state === 'ADDRESS') {
    if (text.length < 4) return reply(res, 'Please send a proper address.');
    s.addr = text; s.state='PAYMENT';
    return reply(res, "Payment method?\n1) Cash on Delivery\n2) Card on Arrival\n3) Online (Paid)");
  }

  // 5) Payment
  if (s.state === 'PAYMENT') {
    if (!['1','2','3'].includes(up))
      return reply(res, "Choose 1, 2, or 3:\n1) Cash on Delivery\n2) Card on Arrival\n3) Online (Paid)");
    s.pay = (up==='1')?'Cash on Delivery':(up==='2')?'Card on Arrival':'Online (Paid)';
    s.state='CONFIRM';
    const item = MENU[s.item]; const total = item.price * s.qty;
    return reply(res,
      `Type 'yes' to confirm, or 'back/reset'.\n\n`+
      `Item: ${item.name} (${s.item})\nQty: ${s.qty}\nAddress: ${s.addr}\n`+
      `Payment: ${s.pay}\nTotal: $${total}`);
  }

  // 6) Confirm -> log to Google Sheet
  if (s.state === 'CONFIRM') {
    if (up !== 'YES') return reply(res, "Type 'yes' to confirm, or 'back/reset'.");
    const id = `ORD-${Date.now().toString().slice(-6)}`;
    const item = MENU[s.item];

    const payload = {
      orderId: id,
      customerName: req.body.ProfileName || '',
      phoneNumber: from,
      orderDetails: `${item.name} (${s.item}) x ${s.qty} — $${item.price*s.qty}`,
      quantity: s.qty,
      deliveryAddress: s.addr,
      paymentMethod: s.pay
    };

    const result = await sendToSheet(payload);
    console.log('Sheets response:', result);

    resetS(s);
    return reply(res, result.ok
      ? "Thanks! Your request has been sent. Type 'hi' to start again."
      : `Order saved but logging failed: ${result.error}\nType 'hi' to start again.`);
  }

  // fallback
  return reply(res, "Type 'hi' to start.");
});

// health
app.get('/', (_req, res) => res.send('OK'));
app.listen(PORT, () => console.log('Server running on', PORT));
