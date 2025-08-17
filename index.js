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

// ---- Config: Menu ----
const MENU = [
  { id: 1, name: "Veg Pizza" },
  { id: 2, name: "Chicken Pizza" },
  { id: 3, name: "Drink" }
];

const WELCOME_TEXT =
  "👋 Welcome!\n" +
  "Type *menu* to see items, or send in the format: _<item> <qty>_\n" +
  "e.g. *pizza 2*";

function renderMenu() {
  const lines = MENU.map(i => `${i.id}. ${i.name}`).join("\n");
  return `📋 *Menu*\n${lines}\n\nReply with a number (e.g. *1 2*) or item name (e.g. *Veg Pizza 2*).`;
}

async function sendWhatsApp(to, body) {
  const basicAuth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  await axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    qs.stringify({ To: to, From: TWILIO_WHATSAPP_FROM, Body: body }),
    { headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
}

async function saveToAirtable({ phone, item, quantity }) {
  await axios.post(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`,
    {
      fields: {
        "Phone Number": phone,
        "Order Item": item,
        "Quantity": quantity,
        "Status": "Pending",
        "Order Time": new Date().toISOString()
      }
    },
    { headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' } }
  );
}

app.get('/', (_req, res) => res.send('🚀 WhatsApp Bot is running with Menu + Airtable!'));

app.post('/whatsapp', async (req, res) => {
  try {
    const fromFull = req.body.From || '';          // "whatsapp:+61..."
    const toReply = fromFull;                       // Twilio expects full "whatsapp:+.."
    const phone = fromFull.replace('whatsapp:', ''); 
    const raw = (req.body.Body || '').trim();

    const lower = raw.toLowerCase();

    // 1) Hi/Menu keywords -> show menu
    if (["hi", "hello", "menu", "help"].includes(lower)) {
      const msg = `${WELCOME_TEXT}\n\n${renderMenu()}`;
      await sendWhatsApp(toReply, msg);
      return res.status(200).send('OK');
    }

    // 2) Handle "number qty" e.g. "1 2"
    const numQtyMatch = raw.match(/^\s*(\d+)\s+(\d+)\s*$/);
    if (numQtyMatch) {
      const id = parseInt(numQtyMatch[1], 10);
      const qty = parseInt(numQtyMatch[2], 10) || 1;
      const found = MENU.find(i => i.id === id);
      if (found) {
        await saveToAirtable({ phone, item: found.name, quantity: qty });
        await sendWhatsApp(toReply, `✅ Order received: *${found.name}* x ${qty}. Status: *Pending*.`);
        return res.status(200).send('OK');
      }
    }

    // 3) Handle "<name> <qty>" e.g. "pizza 2" or "Veg Pizza 3"
    const parts = raw.split(/\s+/);
    const maybeQty = parseInt(parts[parts.length - 1], 10);
    let qty = 1;
    let nameText = raw;

    if (!Number.isNaN(maybeQty)) {
      qty = maybeQty;
      nameText = parts.slice(0, -1).join(' ');
    }

    // Try to map nameText to a known menu item (simple contains match)
    const foundByName =
      MENU.find(i => nameText.toLowerCase().includes(i.name.toLowerCase())) ||
      MENU.find(i => i.name.toLowerCase().includes(nameText.toLowerCase()));

    const itemName = foundByName ? foundByName.name : nameText;

    // If user sent something like "thanks" which is not menu/order, show help
    if (!itemName || itemName.length < 2) {
      await sendWhatsApp(toReply, `${WELCOME_TEXT}\n\n${renderMenu()}`);
      return res.status(200).send('OK');
    }

    // Save order & confirm
    await saveToAirtable({ phone, item: itemName, quantity: qty || 1 });
    await sendWhatsApp(toReply, `✅ Order received: *${itemName}* x ${qty || 1}. Status: *Pending*.`);

    res.status(200).send('OK');
  } catch (err) {
    console.error('❌ Error:', err.response?.data || err.message);
    // Reply with a friendly error message but still 200 so Twilio doesn't retry aggressively
    try {
      const toReply = req.body.From;
      if (toReply) {
        await sendWhatsApp(toReply, "⚠️ Sorry, something went wrong. Please try again or type *menu*.");
      }
    } catch (_) {}
    res.status(200).send('OK');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server on ${PORT}`));
