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

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

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
  { id: 1, key: 'cod', label: 'Cash on Delivery' },
  { id: 2, key: 'counter', label: 'Pay at Counter' },
  { id: 3, key: 'card', label: 'Card' }
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
  const t = text.toLowerCase();
  if (t.includes('al noor')) return RESTAURANTS.find(r => r.key === 'alnoor');
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
  console.log('[WA] ->', body);
  await axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    qs.stringify({ To: to, From: TWILIO_WHATSAPP_FROM, Body: body }),
    { headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
}

// Airtable save with fallback (if Status option mismatch → retry without Status)
async function saveAirtableSafe(order) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`;
  const headers = { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' };

  const payloadWithStatus = {
    fields: {
      'Phone Number': order.phone,
      'Restaurant': order.restaurantName,
      'Order Item': order.item,
      'Quantity': order.quantity,
      'Address': order.address,
      'Payment Method': order.payment,
      'Status': 'Pending',
      'Order Time': new Date().toISOString()
    }
  };
  const payloadNoStatus = {
    fields: {
      'Phone Number': order.phone,
      'Restaurant': order.restaurantName,
      'Order Item': order.item,
      'Quantity': order.quantity,
      'Address': order.address,
      'Payment Method': order.payment,
      'Order Time': new Date().toISOString()
    }
  };

  try {
    console.log('[AT] Save with Status…');
    await axios.post(url, payloadWithStatus, { headers });
    console.log('[AT] Saved with Status');
    return true;
  } catch (e) {
    const code = e?.response?.status;
    console.warn('[AT] Error with Status', code, e?.response?.data);
    if (code === 422) {
      try {
        console.log('[AT] Retry without Status…');
        await axios.post(url, payloadNoStatus, { headers });
        console.log('[AT] Saved without Status');
        return true;
      } catch (e2) {
        console.error('[AT] Failed without Status', e2?.response?.status, e2?.response?.data);
        return false;
      }
    }
    return false;
  }
}

// ----------------- Routes -----------------
app.get('/', (_req, res) => res.send('🚀 Order Flow Bot (guided) running!'));

app.post('/whatsapp', async (req, res) => {
  const fromFull = req.body.From || '';
  const toReply = fromFull;
  const phone = fromFull.replace('whatsapp:', '');
  const raw = (req.body.Body || '').trim();

  try {
    console.log('[IN]', { phone, raw });

    // Controls
    const lower = raw.toLowerCase();
    if (['hi', 'hello', 'start'].includes(lower)) {
      const s = resetSession(phone);
      await sendWA(toReply, `👋 Welcome!\n${renderRestaurantsPrompt()}`);
      return res.status(200).send('OK');
    }
    if (lower === 'restart' || lower === 'reset') {
      const s = resetSession(phone);
      await sendWA(toReply, `🔄 Flow restarted.\n${renderRestaurantsPrompt()}`);
      return res.status(200).send('OK');
    }

    // Ensure session exists
    const s = SESSION[phone] || startSession(phone);

    // STEP: restaurant
    if (s.step === 'restaurant') {
      // Allow: number "1"/"2", "r 1", or names
      let chosen = null;
      const num = raw.match(/^\s*r?\s*(\d+)\s*$/i);
      if (num) {
        const idx = parseInt(num[1], 10);
        chosen = getRestaurantByIndex(idx);
      }
      if (!chosen) {
        chosen = getRestaurantByNameGuess(raw);
      }

      if (!chosen) {
        await sendWA(toReply, `❌ Invalid choice.\n${renderRestaurantsPrompt()}`);
        return res.status(200).send('OK');
      }

      s.restaurantKey = chosen.key;
      s.restaurantName = chosen.name;
      s.step = 'item';
      await sendWA(toReply, `✅ Selected: *${s.restaurantName}*\n\n${renderMenuPrompt(chosen)}\n\n(Type *restart* anytime to start over.)`);
      return res.status(200).send('OK');
    }

    // STEP: item
    if (s.step === 'item') {
      const rest = RESTAURANTS.find(r => r.key === s.restaurantKey);
      if (!rest) {
        s.step = 'restaurant';
        await sendWA(toReply, renderRestaurantsPrompt());
        return res.status(200).send('OK');
      }

      // Match by number "1" or name contains
      let itemObj = null;
      const byNum = raw.match(/^\s*(\d+)\s*$/);
      if (byNum) {
        const id = parseInt(byNum[1], 10);
        itemObj = rest.menu.find(m => m.id === id);
      }
      if (!itemObj) {
        itemObj =
          rest.menu.find(m => raw.toLowerCase().includes(m.name.toLowerCase())) ||
          rest.menu.find(m => m.name.toLowerCase().includes(raw.toLowerCase()));
      }

      if (!itemObj) {
        await sendWA(toReply, `❌ Item not found.\n${renderMenuPrompt(rest)}`);
        return res.status(200).send('OK');
      }

      s.item = itemObj.name;
      s.step = 'qty';
      await sendWA(toReply, renderQtyPrompt(s.item));
      return res.status(200).send('OK');
    }

    // STEP: qty
    if (s.step === 'qty') {
      const q = parseInt(raw, 10);
      if (!q || q < 1 || q > 999) {
        await sendWA(toReply, `❌ Please send a valid quantity (1-999).\n${renderQtyPrompt(s.item)}`);
        return res.status(200).send('OK');
      }
      s.quantity = q;
      s.step = 'address';
      await sendWA(toReply, renderAddressPrompt());
      return res.status(200).send('OK');
    }

    // STEP: address
    if (s.step === 'address') {
      if (!raw || raw.length < 5) {
        await sendWA(toReply, `❌ Address looks too short.\n${renderAddressPrompt()}`);
        return res.status(200).send('OK');
      }
      s.address = raw;
      s.step = 'payment';
      await sendWA(toReply, renderPaymentPrompt());
      return res.status(200).send('OK');
    }

    // STEP: payment
    if (s.step === 'payment') {
      let pm = null;
      const pmNum = raw.match(/^\s*(\d+)\s*$/);
      if (pmNum) {
        const id = parseInt(pmNum[1], 10);
        pm = PM_OPTIONS.find(p => p.id === id);
      }
      if (!pm) {
        // try label match
        const found = PM_OPTIONS.find(p => p.label.toLowerCase() === raw.toLowerCase());
        if (found) pm = found;
      }
      if (!pm) {
        await sendWA(toReply, `❌ Invalid choice.\n${renderPaymentPrompt()}`);
        return res.status(200).send('OK');
      }

      s.payment = pm.label;
      s.step = 'confirm';

      // Save to Airtable
      const saved = await saveAirtableSafe({
        phone,
        restaurantName: s.restaurantName,
        item: s.item,
        quantity: s.quantity,
        address: s.address,
        payment: s.payment
      });

      // Always send confirmation to user (even if save fails)
      const summary = renderSummary(s);
      const tail = saved ? '' : `\n\n⚠️ We had an issue saving your order. Our team will verify manually.`;
      await sendWA(toReply, summary + tail);

      // End session (optionally keep last restaurant)
      resetSession(phone);
      return res.status(200).send('OK');
    }

    // Any other random input → show where we are
    if (s.step === 'confirm') {
      resetSession(phone);
      await sendWA(toReply, `🔄 New order flow started.\n${renderRestaurantsPrompt()}`);
      return res.status(200).send('OK');
    }

    // fallback
    await sendWA(toReply, `ℹ️ Let's continue your order.\nCurrent step: *${s.step}*`);
    res.status(200).send('OK');

  } catch (err) {
    console.error('❌ Handler error:', err.response?.data || err.message);
    try {
      const toReply = req.body.From;
      if (toReply) await sendWA(toReply, '⚠️ Something went wrong. Type *restart* to start over.');
    } catch(_) {}
    res.status(200).send('OK');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Guided Order Bot on ${PORT}`));
