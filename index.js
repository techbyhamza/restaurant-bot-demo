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

// سادہ in-memory سیشن: نمبر -> منتخب ریسٹورنٹ (server ری اسٹارٹ پر ختم ہو جائے گا)
const SESSION = Object.create(null);

// ----------------- Helpers -----------------
const welcome = () =>
  "👋 Welcome!\nType *restaurants* to choose a restaurant, or *menu* to view the current one.\nYou can order like *1 2* (item #1 x2) or *Veg Pizza 3*.";

const renderRestaurants = () =>
  "🏪 *Restaurants*\n" +
  RESTAURANTS.map((r, i) => `${i + 1}. ${r.name}`).join('\n') +
  "\n\nReply *r 1* or *r 2* to select.";

const findRestaurantByIndex = (idx) => RESTAURANTS[idx - 1];
const findRestaurantByKey = (key) => RESTAURANTS.find(r => r.key === key);

const renderMenu = (restaurant) => {
  const lines = restaurant.menu.map(i => `${i.id}. ${i.name}`).join('\n');
  return `📋 *${restaurant.name} Menu*\n${lines}\n\nReply *<number> <qty>* (e.g. *1 2*) or *<name> <qty>* (e.g. *${restaurant.menu[0].name} 2*).\nType *restaurants* to switch.`;
};

async function sendWhatsApp(to, body) {
  const basicAuth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  await axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    qs.stringify({ To: to, From: TWILIO_WHATSAPP_FROM, Body: body }),
    { headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
}

async function saveToAirtable({ phone, restaurantName, item, quantity }) {
  await axios.post(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`,
    {
      fields: {
        'Phone Number': phone,
        'Restaurant': restaurantName,   // اگر آپ نے یہ فیلڈ نہیں بنائی تو اس لائن کو ہٹا دیں
        'Order Item': item,
        'Quantity': quantity,
        'Status': 'Pending',
        'Order Time': new Date().toISOString()
      }
    },
    { headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' } }
  );
}

// ----------------- Routes -----------------
app.get('/', (_req, res) => res.send('🚀 WhatsApp Bot (Multi-Restaurant + Menu + Airtable) running!'));

app.post('/whatsapp', async (req, res) => {
  try {
    const fromFull = req.body.From || '';        // "whatsapp:+61..."
    const toReply = fromFull;
    const phone = fromFull.replace('whatsapp:', '');
    const raw = (req.body.Body || '').trim();
    const lower = raw.toLowerCase();

    // hi/menu/help
    if (['hi', 'hello'].includes(lower)) {
      await sendWhatsApp(toReply, `${welcome()}\n\n${renderRestaurants()}`);
      return res.status(200).send('OK');
    }
    if (lower === 'restaurants') {
      await sendWhatsApp(toReply, renderRestaurants());
      return res.status(200).send('OK');
    }

    // select restaurant: "r 1" یا "r 2"
    const sel = raw.match(/^\s*r\s*(\d+)\s*$/i);
    if (sel) {
      const rIdx = parseInt(sel[1], 10);
      const chosen = findRestaurantByIndex(rIdx);
      if (!chosen) {
        await sendWhatsApp(toReply, "❌ Invalid choice.\n\n" + renderRestaurants());
        return res.status(200).send('OK');
      }
      SESSION[phone] = chosen.key;
      await sendWhatsApp(toReply, `✅ Selected: *${chosen.name}*\n\n${renderMenu(chosen)}`);
      return res.status(200).send('OK');
    }

    // menu (show for current restaurant)
    if (lower === 'menu') {
      const selKey = SESSION[phone];
      const rest = selKey ? findRestaurantByKey(selKey) : null;
      if (!rest) {
        await sendWhatsApp(toReply, "ℹ️ Please select a restaurant first.\n\n" + renderRestaurants());
        return res.status(200).send('OK');
      }
      await sendWhatsApp(toReply, renderMenu(rest));
      return res.status(200).send('OK');
    }

    // اگر ریسٹورنٹ منتخب نہیں تو پہلے سلیکٹ کروائیں
    const selKey = SESSION[phone];
    const currentRestaurant = selKey ? findRestaurantByKey(selKey) : null;
    if (!currentRestaurant) {
      await sendWhatsApp(toReply, "ℹ️ Please select a restaurant first.\n\n" + renderRestaurants());
      return res.status(200).send('OK');
    }

    // "1 2" — numeric item + qty
    const numQty = raw.match(/^\s*(\d+)\s+(\d+)\s*$/);
    if (numQty) {
      const id = parseInt(numQty[1], 10);
      const qty = parseInt(numQty[2], 10) || 1;
      const found = currentRestaurant.menu.find(i => i.id === id);
      if (!found) {
        await sendWhatsApp(toReply, "❌ Invalid item number.\n\n" + renderMenu(currentRestaurant));
        return res.status(200).send('OK');
      }
      await saveToAirtable({ phone, restaurantName: currentRestaurant.name, item: found.name, quantity: qty });
      await sendWhatsApp(toReply, `✅ *${currentRestaurant.name}*: *${found.name}* x ${qty}\nStatus: *Pending*.\n\nType *menu* to order more or *restaurants* to switch.`);
      return res.status(200).send('OK');
    }

    // "<name> <qty>" — name + qty
    const parts = raw.split(/\s+/);
    const maybeQty = parseInt(parts[parts.length - 1], 10);
    let qty = 1;
    let nameText = raw;
    if (!Number.isNaN(maybeQty)) {
      qty = maybeQty;
      nameText = parts.slice(0, -1).join(' ');
    }

    // نام سے میچ کرنے کی کوشش
    const foundByName =
      currentRestaurant.menu.find(i => nameText.toLowerCase().includes(i.name.toLowerCase())) ||
      currentRestaurant.menu.find(i => i.name.toLowerCase().includes(nameText.toLowerCase()));

    const itemName = foundByName ? foundByName.name : nameText;
    if (!itemName || itemName.length < 2) {
      await sendWhatsApp(toReply, "❓ Could not understand the item.\n\n" + renderMenu(currentRestaurant));
      return res.status(200).send('OK');
    }

    await saveToAirtable({ phone, restaurantName: currentRestaurant.name, item: itemName, quantity: qty || 1 });
    await sendWhatsApp(toReply, `✅ *${currentRestaurant.name}*: *${itemName}* x ${qty || 1}\nStatus: *Pending*.\n\nType *menu* to order more or *restaurants* to switch.`);
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
