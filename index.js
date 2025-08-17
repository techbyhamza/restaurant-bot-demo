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

// -------- Restaurants & Menus (8–10 items each) --------
const RESTAURANTS = [
  {
    key: 'alnoor',
    name: 'Al Noor Pizza',
    menu: [
      { id: 1, name: 'Veg Pizza' },
      { id: 2, name: 'Chicken Pizza' },
      { id: 3, name: 'Pepperoni Pizza' },
      { id: 4, name: 'Cheese Garlic Bread' },
      { id: 5, name: 'BBQ Chicken Pizza' },
      { id: 6, name: 'Margherita Pizza' },
      { id: 7, name: 'Tandoori Chicken Pizza' },
      { id: 8, name: 'Coke 1.25L' },
      { id: 9, name: 'Sprite 1.25L' },
      { id: 10, name: 'Water 600ml' }
    ]
  },
  {
    key: 'firstchoice',
    name: 'First Choice',
    menu: [
      { id: 1, name: 'Chicken Biryani' },
      { id: 2, name: 'Beef Biryani' },
      { id: 3, name: 'Chicken Karahi' },
      { id: 4, name: 'Mutton Karahi' },
      { id: 5, name: 'Chicken Handi' },
      { id: 6, name: 'Daal Tadka' },
      { id: 7, name: 'Tandoori Naan' },
      { id: 8, name: 'Raita' },
      { id: 9, name: 'Soft Drink' },
      { id: 10, name: 'Mineral Water' }
    ]
  }
];

// --------- Simple in-memory session (phone -> state) ---------
const SESSION = Object.create(null);
/*
  SESSION[phone] = {
    stage: 'choose_restaurant'|'choose_item'|'choose_qty'|'choose_payment'|'done',
    restaurantKey: 'alnoor'|'firstchoice'|null,
    selectedItem: { id, name } | null,
    quantity: number | null
  }
*/

// ---------- Helpers ----------
const WELCOME =
  "👋 Welcome!\n" +
  "Type *hi* to start, or *reset* anytime.\n" +
  "Flow: Restaurant → Item → Quantity → Payment Method.";

const PAYMENT_METHODS = [
  { key: 'cod', label: 'Cash on Delivery' },
  { key: 'counter', label: 'On Counter' },
  { key: 'online', label: 'Online Payment' }
];

const paymentHelp = () =>
  "💳 *Select payment method:*\n" +
  PAYMENT_METHODS.map((p, i) => `${i + 1}. ${p.label}`).join('\n') +
  "\nReply *1*, *2* or *3* (or type: cod/counter/online).";

const renderRestaurants = () =>
  "🏪 *Select a restaurant:*\n" +
  RESTAURANTS.map((r, i) => `${i + 1}. ${r.name}`).join('\n') +
  "\nReply *r 1* or just *1*. You can also type the name (e.g. *al noor*).";

const findRestaurantByIndex = (idx) => RESTAURANTS[idx - 1];
const findRestaurantByKey = (key) => RESTAURANTS.find(r => r.key === key);

const renderMenu = (restaurant) =>
  `📋 *${restaurant.name} Menu*\n` +
  restaurant.menu.map(i => `${i.id}. ${i.name}`).join('\n') +
  `\n\nReply item *number* or *name* (e.g. *3* or *${restaurant.menu[0].name}*).`;

async function sendWhatsApp(to, body) {
  const basicAuth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  await axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    qs.stringify({ To: to, From: TWILIO_WHATSAPP_FROM, Body: body }),
    { headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
}

async function saveToAirtable({ phone, restaurantName, item, quantity, payment }) {
  await axios.post(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`,
    {
      fields: {
        'Phone Number': phone,
        'Restaurant': restaurantName,
        'Order Item': item,
        'Quantity': quantity,
        'Payment Method': payment,   // رکھنا چاہیں تو کالم بنائیں
        'Status': 'Pending',
        'Order Time': new Date().toISOString()
      }
    },
    { headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' } }
  );
}

function ensureSession(phone) {
  if (!SESSION[phone]) {
    SESSION[phone] = {
      stage: 'choose_restaurant',
      restaurantKey: null,
      selectedItem: null,
      quantity: null
    };
  }
  return SESSION[phone];
}

function matchPayment(input) {
  const s = input.trim().toLowerCase();
  if (s === '1' || s.includes('cod') || s.includes('cash')) return PAYMENT_METHODS[0];
  if (s === '2' || s.includes('counter')) return PAYMENT_METHODS[1];
  if (s === '3' || s.includes('online') || s.includes('card')) return PAYMENT_METHODS[2];
  return null;
}

// ---------- Routes ----------
app.get('/', (_req, res) => res.send('🚀 WhatsApp Bot (Step-by-step flow) is running!'));

app.post('/whatsapp', async (req, res) => {
  try {
    const fromFull = req.body.From || '';       // "whatsapp:+61..."
    const toReply = fromFull;                    // Twilio expects full "whatsapp:+.."
    const phone = fromFull.replace('whatsapp:', '');
    const raw = (req.body.Body || '').trim();
    const lower = raw.toLowerCase();

    // reset
    if (lower === 'reset' || lower === 'restart') {
      delete SESSION[phone];
      await sendWhatsApp(toReply, "🔄 Reset done.\n\n" + renderRestaurants());
      return res.status(200).send('OK');
    }

    // start
    if (['hi', 'hello', 'start'].includes(lower)) {
      SESSION[phone] = {
        stage: 'choose_restaurant',
        restaurantKey: null,
        selectedItem: null,
        quantity: null
      };
      await sendWhatsApp(toReply, `👋 Welcome!\n${renderRestaurants()}`);
      return res.status(200).send('OK');
    }

    const state = ensureSession(phone);

    // --- Stage 1: choose_restaurant ---
    if (state.stage === 'choose_restaurant') {
      // flexible selection: "r 1", "1", names
      let chosen = null;

      const pickR = raw.match(/^\s*r\s*(\d+)\s*$/i);
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

      if (!chosen) {
        await sendWhatsApp(toReply, "❓ Please select a restaurant.\n\n" + renderRestaurants());
        return res.status(200).send('OK');
      }

      state.restaurantKey = chosen.key;
      state.stage = 'choose_item';
      await sendWhatsApp(toReply, `✅ Selected: *${chosen.name}*\n\n${renderMenu(chosen)}`);
      return res.status(200).send('OK');
    }

    // --- Stage 2: choose_item ---
    if (state.stage === 'choose_item') {
      const restaurant = findRestaurantByKey(state.restaurantKey);
      if (!restaurant) {
        state.stage = 'choose_restaurant';
        await sendWhatsApp(toReply, "ℹ️ Please select a restaurant first.\n\n" + renderRestaurants());
        return res.status(200).send('OK');
      }

      // numeric id
      const numOnly = raw.match(/^\s*(\d+)\s*$/);
      let selected = null;

      if (numOnly) {
        const id = parseInt(numOnly[1], 10);
        selected = restaurant.menu.find(i => i.id === id);
      } else {
        // by name contains
        selected =
          restaurant.menu.find(i => raw.toLowerCase().includes(i.name.toLowerCase())) ||
          restaurant.menu.find(i => i.name.toLowerCase().includes(raw.toLowerCase()));
      }

      if (!selected) {
        await sendWhatsApp(toReply, "❌ Invalid item.\n\n" + renderMenu(restaurant));
        return res.status(200).send('OK');
      }

      state.selectedItem = selected;
      state.stage = 'choose_qty';
      await sendWhatsApp(toReply, `🧮 *${selected.name}* selected.\nPlease enter *quantity* (e.g. 2).`);
      return res.status(200).send('OK');
    }

    // --- Stage 3: choose_qty ---
    if (state.stage === 'choose_qty') {
      const qty = parseInt(raw, 10);
      if (!qty || qty < 1 || qty > 999) {
        await sendWhatsApp(toReply, "❌ Please enter a valid quantity (1–999).");
        return res.status(200).send('OK');
      }
      state.quantity = qty;
      state.stage = 'choose_payment';
      await sendWhatsApp(toReply, `💰 Quantity set to *${qty}*.\n\n` + paymentHelp());
      return res.status(200).send('OK');
    }

    // --- Stage 4: choose_payment ---
    if (state.stage === 'choose_payment') {
      const pm = matchPayment(lower);
      if (!pm) {
        await sendWhatsApp(toReply, "❌ Invalid choice.\n\n" + paymentHelp());
        return res.status(200).send('OK');
      }

      // Save & confirm
      const restaurant = findRestaurantByKey(state.restaurantKey);
      const itemName = state.selectedItem?.name || 'Item';
      const qty = state.quantity || 1;

      await saveToAirtable({
        phone,
        restaurantName: restaurant?.name || 'N/A',
        item: itemName,
        quantity: qty,
        payment: pm.label
      });

      await sendWhatsApp(
        toReply,
        `✅ *Order Placed*\n` +
        `🏪 Restaurant: *${restaurant?.name || 'N/A'}*\n` +
        `🍽️ Item: *${itemName}*\n` +
        `🔢 Quantity: *${qty}*\n` +
        `💳 Payment: *${pm.label}*\n` +
        `📦 Status: *Pending*\n\nType *hi* to start new order or *restaurants* to switch.`
      );

      // reset to allow another order smoothly (or keep restaurant)
      SESSION[phone] = {
        stage: 'choose_item',
        restaurantKey: state.restaurantKey,
        selectedItem: null,
        quantity: null
      };
      return res.status(200).send('OK');
    }

    // fallback
    await sendWhatsApp(toReply, `${WELCOME}\n\n${renderRestaurants()}`);
    res.status(200).send('OK');

  } catch (err) {
    console.error('❌ Error:', err.response?.data || err.message);
    try {
      const toReply = req.body.From;
      if (toReply) await sendWhatsApp(toReply, "⚠️ Sorry, something went wrong. Type *hi* or *reset*.");
    } catch (_) {}
    res.status(200).send('OK');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server on ${PORT}`));
