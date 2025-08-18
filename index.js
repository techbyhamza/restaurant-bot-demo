// index.js — Guided Order Bot (stable, no double replies, instant 200, same env names)
// ENV used: AIRTABLE_BASE_ID, AIRTABLE_PAT, AIRTABLE_TABLE_NAME, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const qs = require('qs');

const {
  AIRTABLE_BASE_ID,
  AIRTABLE_PAT,
  AIRTABLE_TABLE_NAME,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM
} = process.env;

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ----------------- Idempotency Guard (avoid duplicate replies) -----------------
const PROCESSED_SIDS = new Map(); // MessageSid -> timestamp
function seenSid(sid) {
  if (!sid) return false;
  const now = Date.now();
  // cleanup old
  for (const [k, t] of PROCESSED_SIDS) if (now - t > 10 * 60 * 1000) PROCESSED_SIDS.delete(k);
  if (PROCESSED_SIDS.has(sid)) return true;
  PROCESSED_SIDS.set(sid, now);
  return false;
}

// ----------------- Restaurants & Menus -----------------
const RESTAURANTS = [
  {
    key: 'alnoor',
    name: 'Al Noor Pizza',
    menu: [
      { id: 1, name: 'Veg Pizza' },
      { id: 2, name: 'Chicken Pizza' },
      { id: 3, name: 'Cheese Garlic Bread' },
      { id: 4, name: 'Coke 1.25L' }
    ]
  },
  {
    key: 'firstchoice',
    name: 'First Choice',
    menu: [
      { id: 1, name: 'Chicken Biryani' },
      { id: 2, name: 'Chicken Karahi' },
      { id: 3, name: 'Tandoori Naan' },
      { id: 4, name: 'Soft Drink' }
    ]
  }
];

// ----------------- Conversation State -----------------
// phone -> { step, restaurantKey, restaurantName, item, quantity, address, payment }
const SESSION = Object.create(null);

// Steps: 'restaurant' -> 'item' -> 'qty' -> 'address' -> 'payment' -> 'confirm'
const PM_OPTIONS = [
  { id: 1, key: 'cod',     label: 'Cash on Delivery' },
  { id: 2, key: 'counter', label: 'Pay at Counter' },
  { id: 3, key: 'card',    label: 'Card' }
];

// ----------------- Helpers -----------------
function startSession(phone) {
  SESSION[phone] = { step: 'restaurant' };
  return SESSION[phone];
}
function resetSession(phone) {
  delete SESSION[phone];
  return startSession(phone);
}

function getRestaurantByIndex(i) {
  return RESTAURANTS[i - 1] || null;
}
function getRestaurantByNameGuess(text) {
  const t = (text || '').toLowerCase();
  if (t.includes('al noor') || t.includes('alnoor')) return RESTAURANTS.find(r => r.key === 'alnoor');
  if (t.includes('first choice') || t.includes('firstchoice')) return RESTAURANTS.find(r => r.key === 'firstchoice');
  return null;
}

function renderRestaurantsPrompt() {
  const lines = RESTAURANTS.map((r, i) => `${i + 1}. ${r.name}`).join('\n');
  return `🏪 *Select a restaurant*\n${lines}\n\nReply with a number (e.g. *1*) or name (e.g. *Al Noor*).`;
}
function renderMenuPrompt(restaurant) {
  const lines = restaurant.menu.map(m => `${m.id}. ${m.name}`).join('\n');
  return `📋 *${restaurant.name} Menu*\n${lines}\n\nPlease send *item number* or *exact item name*.`;
}
function renderQtyPrompt(itemName) {
  return `🧮 *Quantity for* "${itemName}"?\nReply with a number (e.g. *2*).`;
}
function renderAddressPrompt() {
  return `📍 *Please share your delivery address* (street, suburb, postcode).`;
}
function renderPaymentPrompt() {
  const opts = PM_OPTIONS.map(p => `${p.id}. ${p.label}`).join('\n');
  return `💳 *Choose payment method*\n${opts}\n\nReply with a number (e.g. *1*).`;
}
function renderSummary(s) {
  return `🧾 *Order Summary*\n` +
    `Restaurant: ${s.restaurantName}\n` +
    `Item: ${s.item}\n` +
    `Quantity: ${s.quantity}\n` +
    `Address: ${s.address}\n` +
    `Payment: ${s.payment}\n\n` +
    `✅ Thanks! Your order has been placed. Status: *Pending*.`;
}

async function sendWA(to, body) {
  const basicAuth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  console.log('[WA ->]', body);
  return axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    qs.stringify({ To: to, From: TWILIO_WHATSAPP_FROM, Body: body }),
    { headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 8000 }
  ).catch(err => {
    console.error('[WA send error]', err.response?.data || err.message);
  });
}

/** Airtable save with auto-fallback (Full → Minimal). Never throws. */
async function saveAirtableSafe(order) {
  if (!AIRTABLE_BASE_ID || !AIRTABLE_PAT || !AIRTABLE_TABLE_NAME) {
    console.warn('[AT] Missing env — skip save');
    return false;
  }
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`;
  const headers = { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' };

  const payloadFull = {
    fields: {
      'Phone Number': order.phone,
      'Restaurant': order.restaurantName,
      'Order Item': order.item,
      'Quantity': order.quantity,
      'Address': order.address,
      'Payment Method': order.payment,  // may fail if field/options not set
      'Status': 'Pending',
      'Order Time': new Date().toISOString()
    }
  };
  const payloadMinimal = {
    fields: {
      'Phone Number': order.phone,
      'Restaurant': order.restaurantName,
      'Order Item': order.item,
      'Quantity': order.quantity,
      'Address': order.address,
      'Order Time': new Date().toISOString()
    }
  };

  try {
    console.log('[AT] Save FULL…');
    await axios.post(url, payloadFull, { headers, timeout: 8000 });
    console.log('[AT] Saved FULL');
    return true;
  } catch (e) {
    console.warn('[AT] FULL failed:', e?.response?.status, e?.response?.data || e.message);
    try {
      console.log('[AT] Save MINIMAL…');
      await axios.post(url, payloadMinimal, { headers, timeout: 8000 });
      console.log('[AT] Saved MINIMAL');
      return true;
    } catch (e2) {
      console.error('[AT] MINIMAL failed:', e2?.response?.status, e2?.response?.data || e2.message);
      return false;
    }
  }
}

// ----------------- Routes -----------------
app.get('/', (_req, res) => res.send('🚀 Guided Order Bot (stable) running!'));

app.post('/whatsapp', async (req, res) => {
  const sid = req.body.MessageSid;         // Twilio message id (for dedupe)
  const fromFull = req.body.From || '';
  const phone = fromFull.replace('whatsapp:', '');
  const raw = (req.body.Body || '').trim();

  // 1) Immediately ACK to Twilio to prevent retries (very important)
  res.status(200).send('OK');

  // 2) Dedupe repeated webhooks (Twilio may retry)
  if (seenSid(sid)) {
    console.log('[IN DUPLICATE]', { sid, phone, raw });
    return;
  }

  try {
    console.log('[IN]', { sid, phone, raw });
    const toReply = fromFull;
    const lower = raw.toLowerCase();

    // Start / Restart
    if (['hi', 'hello', 'start'].includes(lower)) {
      resetSession(phone);
      await sendWA(toReply, `👋 Welcome!\n${renderRestaurantsPrompt()}`);
      return;
    }
    if (lower === 'restart' || lower === 'reset') {
      resetSession(phone);
      await sendWA(toReply, `🔄 Flow restarted.\n${renderRestaurantsPrompt()}`);
      return;
    }

    // Ensure session
    const s = SESSION[phone] || startSession(phone);

    // STEP: restaurant
    if (s.step === 'restaurant') {
      let chosen = null;
      const num = raw.match(/^\s*r?\s*(\d+)\s*$/i);
      if (num) chosen = getRestaurantByIndex(parseInt(num[1], 10));
      if (!chosen) chosen = getRestaurantByNameGuess(raw);

      if (!chosen) {
        await sendWA(toReply, `❌ Invalid choice.\n${renderRestaurantsPrompt()}`);
        return;
      }

      s.restaurantKey = chosen.key;
      s.restaurantName = chosen.name;
      s.step = 'item';
      await sendWA(toReply, `✅ Selected: *${s.restaurantName}*\n\n${renderMenuPrompt(chosen)}\n\n(Type *restart* anytime to start over.)`);
      return;
    }

    // STEP: item
    if (s.step === 'item') {
      const rest = RESTAURANTS.find(r => r.key === s.restaurantKey);
      if (!rest) {
        s.step = 'restaurant';
        await sendWA(toReply, renderRestaurantsPrompt());
        return;
      }

      let itemObj = null;
      const byNum = raw.match(/^\s*(\d+)\s*$/);
      if (byNum) itemObj = rest.menu.find(m => m.id === parseInt(byNum[1], 10));
      if (!itemObj) {
        itemObj =
          rest.menu.find(m => raw.toLowerCase().includes(m.name.toLowerCase())) ||
          rest.menu.find(m => m.name.toLowerCase().includes(raw.toLowerCase()));
      }

      if (!itemObj) {
        await sendWA(toReply, `❌ Item not found.\n${renderMenuPrompt(rest)}`);
        return;
      }

      s.item = itemObj.name;
      s.step = 'qty';
      await sendWA(toReply, renderQtyPrompt(s.item));
      return;
    }

    // STEP: qty
    if (s.step === 'qty') {
      const q = parseInt(raw, 10);
      if (!q || q < 1 || q > 999) {
        await sendWA(toReply, `❌ Please send a valid quantity (1-999).\n${renderQtyPrompt(s.item)}`);
        return;
      }
      s.quantity = q;
      s.step = 'address';
      await sendWA(toReply, renderAddressPrompt());
      return;
    }

    // STEP: address
    if (s.step === 'address') {
      if (!raw || raw.length < 5) {
        await sendWA(toReply, `❌ Address looks too short.\n${renderAddressPrompt()}`);
        return;
      }
      s.address = raw;
      s.step = 'payment';
      await sendWA(toReply, renderPaymentPrompt());
      return;
    }

    // STEP: payment
    if (s.step === 'payment') {
      let pm = null;
      const pmNum = raw.match(/^\s*(\d+)\s*$/);
      if (pmNum) pm = PM_OPTIONS.find(p => p.id === parseInt(pmNum[1], 10));
      if (!pm) {
        const found = PM_OPTIONS.find(p => p.label.toLowerCase() === raw.toLowerCase());
        if (found) pm = found;
      }
      if (!pm) {
        await sendWA(toReply, `❌ Invalid choice.\n${renderPaymentPrompt()}`);
        return;
      }

      s.payment = pm.label;
      s.step = 'confirm';

      // Fire-and-forget: save then send ONE confirmation (no extra follow-ups)
      saveAirtableSafe({
        phone,
        restaurantName: s.restaurantName,
        item: s.item,
        quantity: s.quantity,
        address: s.address,
        payment: s.payment
      }).catch(()=>{});

      await sendWA(toReply, renderSummary(s));
      resetSession(phone); // end session; no more messages after confirmation
      return;
    }

    // Fallback: tell current step
    await sendWA(toReply, `ℹ️ Let's continue your order.\nCurrent step: *${s.step}*`);
  } catch (err) {
    console.error('❌ Handler error:', err.response?.data || err.message);
    // try a single generic reply (non-blocking)
    try { if (req.body.From) await sendWA(req.body.From, '⚠️ Something went wrong. Type *restart* to start over.'); } catch(_) {}
  }
});

// Start
app.listen(PORT, () => console.log(`✅ Guided Order Bot (stable) on ${PORT}`));
