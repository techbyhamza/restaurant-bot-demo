// index.js — Uses your existing envs: AIRTABLE_PAT, AIRTABLE_BASE_ID, AIRTABLE_TABLE_NAME
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { MessagingResponse } = require('twilio').twiml;

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

const PORT = process.env.PORT || 3000;

// ✅ Use your existing variables (no new names)
const AIRTABLE_PAT         = process.env.AIRTABLE_PAT;        // your API key (PAT)
const AIRTABLE_BASE_ID     = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME  = process.env.AIRTABLE_TABLE_NAME || 'Orders';
// (Optional info)
const TWILIO_ACCOUNT_SID   = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || '';

// In-memory sessions: { phone: { step, data } }
const sessions = {};

// English menus (as requested)
const MENUS = {
  'Al Noor Pizza': ['Margherita', 'Pepperoni', 'BBQ Chicken'],
  'First Choice': ['Zinger Burger', 'Shawarma', 'Club Sandwich']
};

// ---------- Helpers ----------
const nowISO = () => new Date().toISOString();
const log = (...a) => console.log('[BOT]', ...a);

function sendXml(res, text) {
  const tw = new MessagingResponse();
  tw.message(text);
  res.type('text/xml').send(tw.toString());
}

const norm = s => (s || '').trim().toLowerCase();

// match number (1..N) or contain text
function matchChoice(input, options) {
  const t = norm(input);
  const n = parseInt(t, 10);
  if (!isNaN(n) && n >= 1 && n <= options.length) return n;
  for (let i = 0; i < options.length; i++) {
    if (t.includes(norm(options[i]))) return i + 1;
  }
  return null;
}

// Background Airtable save — never blocks reply
function saveToAirtableBkg(fields) {
  try {
    if (!AIRTABLE_PAT || !AIRTABLE_BASE_ID || !AIRTABLE_TABLE_NAME) {
      return log('⚠️ Missing Airtable env, skip save');
    }
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`;
    const headers = {
      Authorization: `Bearer ${AIRTABLE_PAT}`,
      'Content-Type': 'application/json'
    };
    const payload = { records: [{ fields }], typecast: true };

    axios.post(url, payload, { headers, timeout: 5000 })
      .then(r => log('✅ Airtable saved:', r?.data?.records?.[0]?.id))
      .catch(e => log('❌ Airtable error:', e?.response?.data || e.message));
  } catch (e) {
    log('❌ Airtable exception:', e.message);
  }
}

// ---------- Health ----------
app.get('/', (_req, res) => res.send('OK - restaurant bot running'));
app.get('/health', (_req, res) => res.json({
  ok: true,
  env: {
    AIRTABLE_PAT: !!AIRTABLE_PAT,
    AIRTABLE_BASE_ID: !!AIRTABLE_BASE_ID,
    AIRTABLE_TABLE_NAME: AIRTABLE_TABLE_NAME,
    TWILIO_ACCOUNT_SID: !!TWILIO_ACCOUNT_SID,
    TWILIO_WHATSAPP_FROM: !!TWILIO_WHATSAPP_FROM
  }
}));

// ---------- WhatsApp webhook ----------
app.post('/whatsapp', (req, res) => {
  const from = (req.body.From || '').replace('whatsapp:', '');
  const text = (req.body.Body || '').trim();
  log('📩 Incoming', { from, text, at: nowISO() });

  if (!sessions[from]) sessions[from] = { step: 'welcome', data: {} };
  const s = sessions[from];

  try {
    // 1) Welcome
    if (s.step === 'welcome') {
      s.step = 'restaurant';
      return sendXml(res,
        "👋 Welcome! Please choose a restaurant:\n" +
        "1) Al Noor Pizza\n" +
        "2) First Choice\n\n" +
        "Reply with 1 or 2."
      );
    }

    // 2) Restaurant
    if (s.step === 'restaurant') {
      const rChoices = ['Al Noor Pizza', 'First Choice'];
      const idx = matchChoice(text, rChoices);
      if (!idx) {
        return sendXml(res, "Please reply with 1 or 2:\n1) Al Noor Pizza\n2) First Choice");
      }
      s.data.restaurant = rChoices[idx - 1];

      const menu = MENUS[s.data.restaurant].map((x, i) => `${i + 1}) ${x}`).join('\n');
      s.step = 'menu';
      return sendXml(res,
        `You chose: ${s.data.restaurant}\n\n` +
        `Menu:\n${menu}\n\n` +
        `Please send the item number (e.g., 1).`
      );
    }

    // 3) Menu item
    if (s.step === 'menu') {
      const items = MENUS[s.data.restaurant] || [];
      const idx = matchChoice(text, items);
      if (!idx) {
        const menu = items.map((x, i) => `${i + 1}) ${x}`).join('\n');
        return sendXml(res, `Please send a valid item number:\n${menu}`);
      }
      s.data.item = items[idx - 1];
      s.step = 'quantity';
      return sendXml(res, `Great choice: ${s.data.item}!\nHow many would you like? (e.g., 2)`);
    }

    // 4) Quantity
    if (s.step === 'quantity') {
      const qty = parseInt(text, 10);
      if (isNaN(qty) || qty < 1) {
        return sendXml(res, "Please send a valid quantity (e.g., 2).");
      }
      s.data.quantity = qty;
      s.step = 'mode';
      return sendXml(res,
        "Choose order mode:\n" +
        "1) Dine-in\n" +
        "2) Takeaway\n\n" +
        "Reply with 1 or 2."
      );
    }

    // 5) Mode (Dine-in / Takeaway)
    if (s.step === 'mode') {
      const modes = ['Dine-in', 'Takeaway'];
      const idx = matchChoice(text, modes);
      if (!idx) {
        return sendXml(res, "Please reply with 1 or 2:\n1) Dine-in\n2) Takeaway");
      }
      s.data.mode = modes[idx - 1];

      if (s.data.mode === 'Takeaway') {
        s.step = 'address';
        return sendXml(res, "Please type your delivery address.");
      } else {
        s.data.address = ''; // dine-in → no address
        s.step = 'payment';
        return sendXml(res,
          "Select payment method:\n" +
          "1) Pay at Counter\n" +
          "2) Cash on Delivery\n" +
          "3) Online Payment\n\n" +
          "Reply with 1, 2, or 3."
        );
      }
    }

    // 6) Address (only when Takeaway)
    if (s.step === 'address') {
      if (!text || text.length < 3) {
        return sendXml(res, "Please provide a valid delivery address.");
      }
      s.data.address = text;
      s.step = 'payment';
      return sendXml(res,
        "Select payment method:\n" +
        "1) Pay at Counter\n" +
        "2) Cash on Delivery\n" +
        "3) Online Payment\n\n" +
        "Reply with 1, 2, or 3."
      );
    }

    // 7) Payment
    if (s.step === 'payment') {
      const pays = ['Pay at Counter', 'Cash on Delivery', 'Online Payment'];
      const idx = matchChoice(text, pays);
      if (!idx) {
        return sendXml(res, "Please reply with 1, 2, or 3:\n1) Pay at Counter\n2) Cash on Delivery\n3) Online Payment");
      }
      s.data.payment = pays[idx - 1];

      // ----- Save to Airtable (your 6 columns only) -----
      const fields = {
        'Phone Number': from,
        'Order Item': `${s.data.item} @ ${s.data.restaurant}`, // restaurant included inline
        'Quantity': s.data.quantity,
        'Address': s.data.mode === 'Takeaway' ? (s.data.address || '') : '',
        'Status': 'Pending',
        'Order Time': nowISO()
      };
      saveToAirtableBkg(fields);

      const confirmation =
        `✅ Order confirmed!\n\n` +
        `Restaurant: ${s.data.restaurant}\n` +
        `Item: ${s.data.item}\n` +
        `Quantity: ${s.data.quantity}\n` +
        `Mode: ${s.data.mode}\n` +
        (s.data.mode === 'Takeaway' ? `Address: ${s.data.address}\n` : '') +
        `Payment: ${s.data.payment}\n` +
        `Thank you!`;

      delete sessions[from];
      return sendXml(res, confirmation);
    }

    // fallback reset
    sessions[from] = { step: 'welcome', data: {} };
    return sendXml(res, 'Welcome! Please reply "Hi" to start again.');
  } catch (err) {
    console.error('🚨 Handler error:', err?.stack || err?.message);
    return sendXml(res, 'Temporary issue — please try again.');
  }
});

// Start server
app.listen(PORT, () => log(`Server running on port ${PORT}`));
