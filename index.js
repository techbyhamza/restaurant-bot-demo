// index.js — EN-only menu, Takeaway asks Address, fast replies, Airtable save in background
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
const USE_EXTENDED_FIELDS = process.env.USE_EXTENDED_FIELDS === '1'; // add Restaurant/Mode/Payment when true

// In-memory session store: { phone: { step, data } }
const sessions = {};

// Menus (English only, as requested)
const MENUS = {
  'Al Noor Pizza': ['Margherita', 'Pepperoni', 'BBQ Chicken'],
  'First Choice': ['Zinger Burger', 'Shawarma', 'Club Sandwich']
};

// Utils
const nowISO = () => new Date().toISOString();
const send = (res, msg) => {
  const tw = new MessagingResponse();
  tw.message(msg);
  res.type('text/xml').send(tw.toString());
};
const norm = s => (s || '').trim().toLowerCase();

// Match either number (1..N) or text containing option
function matchNumberedChoice(input, options) {
  const t = norm(input);
  const n = parseInt(t, 10);
  if (!isNaN(n) && n >= 1 && n <= options.length) return n;
  for (let i = 0; i < options.length; i++) {
    if (t.includes(norm(options[i]))) return i + 1;
  }
  return null;
}

// Background Airtable save (never blocks reply)
function saveToAirtableBkg(fields) {
  try {
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID || !AIRTABLE_TABLE_NAME) {
      console.warn('Airtable ENV missing; skipping save');
      return;
    }
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`;
    const headers = {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    };
    const payload = { records: [{ fields }], typecast: true };

    axios.post(url, payload, { headers, timeout: 4000 })
      .then(r => console.log('✅ Airtable saved:', r?.data?.records?.[0]?.id, fields))
      .catch(e => console.error('❌ Airtable save error:', e?.response?.data || e.message));
  } catch (e) {
    console.error('Airtable save exception:', e.message);
  }
}

// Health & Echo
app.get('/', (_req, res) => res.send('OK - restaurant bot running'));
app.get('/health', (_req, res) => res.json({
  ok: true,
  env: {
    AIRTABLE_API_KEY: !!AIRTABLE_API_KEY,
    AIRTABLE_BASE_ID: !!AIRTABLE_BASE_ID,
    AIRTABLE_TABLE_NAME: AIRTABLE_TABLE_NAME,
    USE_EXTENDED_FIELDS
  }
}));
app.all('/echo', (req, res) => res.json({ method: req.method, body: req.body, query: req.query }));

// WhatsApp webhook
app.post('/whatsapp', (req, res) => {
  const from = (req.body.From || '').replace('whatsapp:', '');
  const text = (req.body.Body || '').trim();
  console.log('📩', { from, text, at: nowISO() });

  if (!sessions[from]) sessions[from] = { step: 'welcome', data: {} };
  const s = sessions[from];

  try {
    // STEP 1: Welcome
    if (s.step === 'welcome') {
      s.step = 'restaurant';
      return send(res,
        "👋 Welcome! Please choose a restaurant:\n" +
        "1) Al Noor Pizza\n" +
        "2) First Choice\n\n" +
        "Reply with 1 or 2."
      );
    }

    // STEP 2: Restaurant
    if (s.step === 'restaurant') {
      const choices = ['Al Noor Pizza', 'First Choice'];
      const idx = matchNumberedChoice(text, choices);
      if (!idx) {
        return send(res, "Please reply with 1 or 2:\n1) Al Noor Pizza\n2) First Choice");
      }
      s.data.restaurant = choices[idx - 1];

      const menu = MENUS[s.data.restaurant].map((x, i) => `${i + 1}) ${x}`).join('\n');
      s.step = 'menu';
      return send(res,
        `You chose: ${s.data.restaurant}\n\n` +
        `Menu:\n${menu}\n\n` +
        `Please send the item number (e.g., 1).`
      );
    }

    // STEP 3: Menu item
    if (s.step === 'menu') {
      const items = MENUS[s.data.restaurant] || [];
      const idx = matchNumberedChoice(text, items);
      if (!idx) {
        const menu = items.map((x, i) => `${i + 1}) ${x}`).join('\n');
        return send(res, `Please send a valid item number:\n${menu}`);
      }
      s.data.item = items[idx - 1];
      s.step = 'quantity';
      return send(res, `Great choice: ${s.data.item}!\nHow many would you like? (e.g., 2)`);
    }

    // STEP 4: Quantity
    if (s.step === 'quantity') {
      const qty = parseInt(text, 10);
      if (isNaN(qty) || qty < 1) {
        return send(res, "Please send a valid quantity (e.g., 2).");
      }
      s.data.quantity = qty;
      s.step = 'mode';
      return send(res,
        "Choose order mode:\n" +
        "1) Dine-in\n" +
        "2) Takeaway\n\n" +
        "Reply with 1 or 2."
      );
    }

    // STEP 5: Mode (Dine-in / Takeaway)
    if (s.step === 'mode') {
      const modes = ['Dine-in', 'Takeaway'];
      const idx = matchNumberedChoice(text, modes);
      if (!idx) {
        return send(res, "Please reply with 1 or 2:\n1) Dine-in\n2) Takeaway");
      }
      s.data.mode = modes[idx - 1];

      if (s.data.mode === 'Takeaway') {
        s.step = 'address';
        return send(res, "Please type your delivery address.");
      } else {
        // Dine-in → skip address
        s.data.address = '';
        s.step = 'payment';
        return send(res,
          "Select payment method:\n" +
          "1) Pay at Counter\n" +
          "2) Cash on Delivery\n" +
          "3) Online Payment\n\n" +
          "Reply with 1, 2, or 3."
        );
      }
    }

    // STEP 6 (conditional): Address (only for Takeaway)
    if (s.step === 'address') {
      if (!text || text.length < 3) {
        return send(res, "Please provide a valid delivery address.");
      }
      s.data.address = text;
      s.step = 'payment';
      return send(res,
        "Select payment method:\n" +
        "1) Pay at Counter\n" +
        "2) Cash on Delivery\n" +
        "3) Online Payment\n\n" +
        "Reply with 1, 2, or 3."
      );
    }

    // STEP 7: Payment
    if (s.step === 'payment') {
      const pays = ['Pay at Counter', 'Cash on Delivery', 'Online Payment'];
      const idx = matchNumberedChoice(text, pays);
      if (!idx) {
        return send(res, "Please reply with 1, 2, or 3:\n1) Pay at Counter\n2) Cash on Delivery\n3) Online Payment");
      }
      s.data.payment = pays[idx - 1];

      // Build Airtable fields (safe defaults = your 6 columns)
      const baseFields = {
        'Phone Number': from,
        'Order Item': `${s.data.item} @ ${s.data.restaurant}`,
        'Quantity': s.data.quantity,
        'Address': s.data.mode === 'Takeaway' ? (s.data.address || '') : '',
        'Status': 'Pending',
        'Order Time': nowISO()
      };

      const extended = USE_EXTENDED_FIELDS ? {
        'Restaurant': s.data.restaurant,
        'Mode': s.data.mode,
        'Payment': s.data.payment
      } : {};

      // Save in background
      saveToAirtableBkg({ ...baseFields, ...extended });

      const confirm =
        `✅ Order confirmed!\n\n` +
        `Restaurant: ${s.data.restaurant}\n` +
        `Item: ${s.data.item}\n` +
        `Quantity: ${s.data.quantity}\n` +
        `Mode: ${s.data.mode}\n` +
        (s.data.mode === 'Takeaway' ? `Address: ${s.data.address}\n` : '') +
        `Payment: ${s.data.payment}\n` +
        `Thank you!`;
      delete sessions[from];
      return send(res, confirm);
    }

    // Fallback reset
    sessions[from] = { step: 'welcome', data: {} };
    return send(res, 'Welcome! Please reply "Hi" to start again.');
  } catch (err) {
    console.error('🚨 Handler error:', err?.stack || err?.message);
    return send(res, 'Temporary issue — please try again.');
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
