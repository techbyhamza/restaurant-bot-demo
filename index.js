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

// In-memory session: phone -> selected restaurant key
const SESSION = Object.create(null);

// ----------------- Helpers -----------------
const welcome = () =>
  "👋 Welcome!\n" +
  "Type *restaurants* to choose a restaurant, or *menu* to view the current one.\n" +
  "You can order like *1 2* (item #1 x2) or *Veg Pizza 3*.";

const renderRestaurants = () =>
  "🏪 *Restaurants*\n" +
  RESTAURANTS.map((r, i) => `${i + 1}. ${r.name}`).join('\n') +
  "\n\nReply *r 1* or just *1* to select. You can also type the name (e.g. *al noor*).";

const findRestaurantByIndex = (idx) => RESTAURANTS[idx - 1];
const findRestaurantByKey = (key) => RESTAURANTS.find(r => r.key === key);

const renderMenu = (restaurant) => {
  const lines = restaurant.menu.map(i => `${i.id}. ${i.name}`).join('\n');
  return `📋 *${restaurant.name} Menu*\n${lines}\n\n` +
         `Reply *<number> <qty>* (e.g. *1 2*) or *<name> <qty>* (e.g. *${restaurant.menu[0].name} 2*).\n` +
         `Type *restaurants* to switch.`;
};

async function sendWhatsApp(to, body) {
  const basicAuth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  console.log('[WA] Sending to', to, '->', body);
  await axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    qs.stringify({ To: to, From: TWILIO_WHATSAPP_FROM, Body: body }),
    { headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
}

/**
 * Safe Airtable save:
 *  - Try with Status="Pending"
 *  - If 422 (select option) => retry without Status (assumes default in Airtable)
 *  - Returns { ok: boolean, error?: any }
 */
async function saveToAirtableSafe({ phone, restaurantName, item, quantity }) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`;
  const headers = { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' };

  const payloadWithStatus = {
    fields: {
      'Phone Number': phone,
      'Restaurant': restaurantName, // remove this line if you don't keep a Restaurant column
      'Order Item': item,
      'Quantity': quantity,
      'Status': 'Pending',
      'Order Time': new Date().toISOString()
    }
  };

  const payloadNoStatus = {
    fields: {
      'Phone Number': phone,
      'Restaurant': restaurantName, // remove this line if not needed
      'Order Item': item,
      'Quantity': quantity,
      'Order Time': new Date().toISOString()
    }
  };

  try {
    console.log('[AT] Creating record (with Status)…', { item, quantity, restaurantName });
    await axios.post(url, payloadWithStatus, { headers });
    console.log('[AT] Saved with Status');
    return { ok: true };
  } catch (e) {
    const code = e?.response?.status;
    const data = e?.response?.data;
    console.warn('[AT] Error with Status:', code, data);
    // If select option problem, try without Status (use default in Airtable)
    if (code === 422) {
      try {
        console.log('[AT] Retrying without Status (expecting default)…');
        await axios.post(url, payloadNoStatus, { headers });
        console.log('[AT] Saved without Status');
        return { ok: true };
      } catch (e2) {
        console.error('[AT] Failed without Status:', e2?.response?.status, e2?.response?.data);
        return { ok: false, error: e2?.response?.data || e2.message };
      }
    }
    return { ok: false, error: data || e.message };
  }
}

// ----------------- Routes -----------------
app.get('/', (_req, res) => res.send('🚀 WhatsApp Bot (Multi-Restaurant + Menu + Airtable) running!'));

app.post('/whatsapp', async (req, res) => {
  try {
    const fromFull = req.body.From || '';       // "whatsapp:+61..."
    const toReply = fromFull;
    const phone = fromFull.replace('whatsapp:', '');
    const raw = (req.body.Body || '').trim();
    const lower = raw.toLowerCase();

    console.log('[IN]', { from: phone, raw });

    // 0) Greetings / help
    if (['hi', 'hello', 'help'].includes(lower)) {
      await sendWhatsApp(toReply, `${welcome()}\n\n${renderRestaurants()}`);
      return res.status(200).send('OK');
    }

    // 1) Show restaurants list
    if (lower === 'restaurants') {
      await sendWhatsApp(toReply, renderRestaurants());
      return res.status(200).send('OK');
    }

    // 2) Flexible restaurant selection
    let currentKey = SESSION[phone] || null;
    let currentRestaurant = currentKey ? findRestaurantByKey(currentKey) : null;

    const wantSelect =
      lower === 'select restaurant' ||
      lower.startsWith('r ') ||
      /^\s*\d+\s*$/.test(lower) ||
      lower.includes('al noor') ||
      lower.includes('first choice') ||
      lower === 'r1' || lower === 'r2';

    if (!currentRestaurant || wantSelect) {
      let chosen = null;

      // "r 1" / "r 2"
      const pickR = raw.match(/^\s*r\s*(\d+)\s*$/i);
      // "1" / "2"
      const pickNumOnly = raw.match(/^\s*(\d+)\s*$/);

      if (pickR) {
        const idx = parseInt(pickR[1], 10);
        chosen = findRestaurantByIndex(idx);
      } else if (pickNumOnly) {
        const idx = parseInt(pickNumOnly[1], 10);
        chosen = findRestaurantByIndex(idx);
      } else if (lower.includes('al noor')) {
        chosen = findRestaurantByKey('alnoor');
      } else if (lower.includes('first choice')) {
        chosen = findRestaurantByKey('firstchoice');
      }

      if (chosen) {
        SESSION[phone] = chosen.key;
        currentKey = chosen.key;
        currentRestaurant = chosen;
        await sendWhatsApp(toReply, `✅ Selected: *${chosen.name}*\n\n${renderMenu(chosen)}`);
        return res.status(200).send('OK');
      }

      if (!currentRestaurant && (lower === 'menu' || wantSelect)) {
        await sendWhatsApp(toReply, "ℹ️ Please select a restaurant first.\n\n" + renderRestaurants());
        return res.status(200).send('OK');
      }
    }

    // 3) Show menu
    if (lower === 'menu') {
      if (!currentRestaurant) {
        await sendWhatsApp(toReply, "ℹ️ Please select a restaurant first.\n\n" + renderRestaurants());
        return res.status(200).send('OK');
      }
      await sendWhatsApp(toReply, renderMenu(currentRestaurant));
      return res.status(200).send('OK');
    }

    // 4) Place order — numeric "1 2"
    if (currentRestaurant) {
      const numQty = raw.match(/^\s*(\d+)\s+(\d+)\s*$/);
      if (numQty) {
        const id = parseInt(numQty[1], 10);
        const qty = parseInt(numQty[2], 10) || 1;
        const found = currentRestaurant.menu.find(i => i.id === id);
        if (!found) {
          await sendWhatsApp(toReply, "❌ Invalid item number.\n\n" + renderMenu(currentRestaurant));
          return res.status(200).send('OK');
        }

        const result = await saveToAirtableSafe({
          phone,
          restaurantName: currentRestaurant.name,
          item: found.name,
          quantity: qty
        });

        const confirm = result.ok
          ? `✅ *${currentRestaurant.name}*: *${found.name}* x ${qty}\nStatus: *Pending*.\n\nThanks! Your order has been placed.`
          : `✅ *${currentRestaurant.name}*: *${found.name}* x ${qty}\n(We received your order, but there was a save issue. We'll confirm shortly.)`;

        await sendWhatsApp(toReply, confirm + `\n\nType *menu* to order more or *restaurants* to switch.`);
        return res.status(200).send('OK');
      }

      // 5) Place order — "<name> <qty>" or just "<name>"
      const parts = raw.split(/\s+/);
      const maybeQty = parseInt(parts[parts.length - 1], 10);
      let qty = 1;
      let nameText = raw;
      if (!Number.isNaN(maybeQty)) {
        qty = maybeQty;
        nameText = parts.slice(0, -1).join(' ');
      }

      const foundByName =
        currentRestaurant.menu.find(i => nameText.toLowerCase().includes(i.name.toLowerCase())) ||
        currentRestaurant.menu.find(i => i.name.toLowerCase().includes(nameText.toLowerCase()));

      const itemName = foundByName ? foundByName.name : nameText;
      if (itemName && itemName.length >= 2) {
        const result = await saveToAirtableSafe({
          phone,
          restaurantName: currentRestaurant.name,
          item: itemName,
          quantity: qty || 1
        });

        const confirm = result.ok
          ? `✅ *${currentRestaurant.name}*: *${itemName}* x ${qty || 1}\nStatus: *Pending*.\n\nThanks! Your order has been placed.`
          : `✅ *${currentRestaurant.name}*: *${itemName}* x ${qty || 1}\n(We received your order, but there was a save issue. We'll confirm shortly.)`;

        await sendWhatsApp(toReply, confirm + `\n\nType *menu* to order more or *restaurants* to switch.`);
        return res.status(200).send('OK');
      }
    }

    // 6) Fallback
    await sendWhatsApp(toReply, `${welcome()}\n\n${renderRestaurants()}`);
    res.status(200).send('OK');

  } catch (err) {
    console.error('❌ Error:', err.response?.data || err.message);
    try {
      const toReply = req.body.From;
      if (toReply) await sendWhatsApp(toReply, "⚠️ Sorry, something went wrong. Type *restaurants* or *menu*.");
    } catch (_) {}
    res.status(200).send('OK');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server on ${PORT}`));
