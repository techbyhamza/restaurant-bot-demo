/* index.js - WhatsApp Cloud API Bot (Mandi + Fuadijan) with Airtable (ID > Name fallback)
 * Env required:
 * PORT=3000
 * VERIFY_TOKEN=...
 * PHONE_NUMBER_ID=...
 * WHATSAPP_TOKEN=... (or use ACCESS_TOKEN)
 * ACCESS_TOKEN=... (fallback)
 * AIRTABLE_API_KEY=pat_xxx
 * AIRTABLE_BASE_ID_MANDI=appXXXXXXXXXXXXXX
 * AIRTABLE_BASE_ID_FUADIJAN=appYYYYYYYYYYYY
 * AIRTABLE_TABLE_ID_MANDI=tblXXXXXXXXXXXX   (preferred)
 * AIRTABLE_TABLE_ID_FUADIJAN=tblYYYYYYYYYY  (preferred)
 * AIRTABLE_TABLE_MANDI=Orders_mandi         (fallback name)
 * AIRTABLE_TABLE_FUADIJAN=Orders_Fuadijan   (fallback name)
 */

require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(bodyParser.json());

// ====== ENV ======
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// WhatsApp token fallback: prefer WHATSAPP_TOKEN, else ACCESS_TOKEN
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || process.env.ACCESS_TOKEN;

// Airtable
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;

const AIRTABLE_BASE_ID_MANDI = process.env.AIRTABLE_BASE_ID_MANDI;
const AIRTABLE_BASE_ID_FUADIJAN = process.env.AIRTABLE_BASE_ID_FUADIJAN;

// Prefer table IDs; fall back to names if IDs not provided
const AIRTABLE_TABLE_ID_MANDI = process.env.AIRTABLE_TABLE_ID_MANDI;
const AIRTABLE_TABLE_ID_FUADIJAN = process.env.AIRTABLE_TABLE_ID_FUADIJAN;
const AIRTABLE_TABLE_MANDI = process.env.AIRTABLE_TABLE_MANDI;
const AIRTABLE_TABLE_FUADIJAN = process.env.AIRTABLE_TABLE_FUADIJAN;

// ====== WhatsApp helpers ======
const WA_URL = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;

async function sendText(to, body) {
  try {
    await axios.post(
      WA_URL,
      { messaging_product: "whatsapp", to, type: "text", text: { body } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("sendText error:", e?.response?.data || e.message);
  }
}

function fmtCart(cart) {
  if (!cart || cart.length === 0) return "—";
  return cart.map((c, i) => `${i + 1}) ${c.item} × ${c.qty}${c.price ? ` — $${c.price}` : ""}`).join("\n");
}

// ====== Simple in-memory session store ======
const SESSIONS = {}; // { phone: { step, restaurant, category, item, qty, cart:[], orderType, address, customerName, guests } }

function startSession(phone) {
  SESSIONS[phone] = {
    step: "ASK_RESTAURANT",
    restaurant: null,
    category: null,
    item: null,
    qty: null,
    cart: [],
    orderType: null,
    address: null,
    customerName: null,
    guests: null,
  };
}

function resetSession(phone) {
  delete SESSIONS[phone];
  startSession(phone);
}

// ====== Menus (same as before) ======
const MENUS = {
  MANDI: {
    name: "Mat’am Al Mandi",
    categories: {
      "1": { name: "Mandi – Single", items: ["Chicken Mandi", "Lamb Mandi", "Mix Mandi"] },
      "2": { name: "Mandi – Meal", items: ["Chicken Mandi Meal", "Lamb Mandi Meal"] },
      "3": { name: "Curries", items: ["Chicken Curry", "Mutton Curry", "Daal"] },
      "4": { name: "Breads", items: ["Roti", "Naan", "Paratha"] },
      "5": { name: "Desserts", items: ["Kheer", "Gulab Jamun"] },
    },
  },
  FUADIJAN: {
    name: "Fuadijan",
    categories: {
      "1": { name: "Drinks", items: ["Water", "Cola", "Mango Lassi"] },
      "2": { name: "Breakfast", items: ["Omelette", "Paratha Roll"] },
      "3": { name: "Karahi & Nihari", items: ["Chicken Karahi", "Beef Nihari"] },
      "4": { name: "Burgers & Wraps", items: ["Zinger Burger", "Chicken Wrap"] },
      "5": { name: "Snacks", items: ["Fries", "Samosa", "Pakora"] },
      "6": { name: "Plates", items: ["Biryani Plate", "Grill Plate"] },
      "7": { name: "Add-ons", items: ["Raita", "Salad"] },
      "8": { name: "Sweets", items: ["Jalebi", "Ras Malai"] },
    },
  },
};

// ====== Prompts ======
function restaurantPrompt() {
  return (
    "براہ کرم ریسٹورنٹ منتخب کریں:\n" +
    "1) Mat’am Al Mandi\n" +
    "2) Fuadijan\n\n" +
    "کسی بھی وقت 'reset' لکھ کر نئی شاپنگ شروع کر سکتے ہیں۔"
  );
}

function categoriesPrompt(restKey) {
  const r = MENUS[restKey];
  const lines = Object.entries(r.categories).map(([code, cat]) => `${code}) ${cat.name}`).join("\n");
  return `آپ نے **${r.name}** منتخب کیا ہے۔\nCategory منتخب کریں:\n${lines}`;
}

function itemsPrompt(restKey, catCode) {
  const cat = MENUS[restKey].categories[catCode];
  if (!cat) return "غلط category کوڈ۔ دوبارہ کوشش کریں۔";
  const lines = cat.items.map((it, idx) => `${idx + 1}) ${it}`).join("\n");
  return `*${cat.name}* سے آئٹم منتخب کریں:\n${lines}`;
}

function addMoreOrCheckoutPrompt(cart) {
  return `آپ کے cart میں:\n${fmtCart(cart)}\n\nمزید آئٹم add کرنے کیلئے '1' لکھیں\nCheckout کرنے کیلئے '2' لکھیں`;
}

function orderTypePrompt() {
  return "Order type منتخب کریں:\n1) Delivery\n2) Take-away\n3) Dine-in";
}

// ====== Airtable helper ======
function airtableUrl(baseId, tableIdOrName) {
  return `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableIdOrName)}`;
}

// ====== Airtable save functions (ID > Name) ======
async function saveRecordToAirtable_MANDI(data) {
  const tableKey = AIRTABLE_TABLE_ID_MANDI || AIRTABLE_TABLE_MANDI;
  const fields = {
    "Phone Number": data.phone,
    "Order Item": data.item,
    "Quantity": String(data.qty),
    "Order Type": data.orderType,
    "Address": data.address || "",
    "Status": "Pending",
    "Order Time": new Date().toISOString(),
    // Mandi: required Attachment → add dummy
    "Attachment": [{ url: "https://via.placeholder.com/150" }],
  };

  return axios.post(
    airtableUrl(AIRTABLE_BASE_ID_MANDI, tableKey),
    { fields },
    { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}`, "Content-Type": "application/json" } }
  );
}

async function saveRecordToAirtable_FUADIJAN(data) {
  const tableKey = AIRTABLE_TABLE_ID_FUADIJAN || AIRTABLE_TABLE_FUADIJAN;
  const fields = {
    "CustomerName": data.customerName || "",
    "PhoneNumber": data.phone,
    "MenuItem": data.item,
    "Quantity": String(data.qty),
    "OrderType": data.orderType,
    "Address": data.address || "",
    "OrderTime": new Date().toISOString(),
  };

  return axios.post(
    airtableUrl(AIRTABLE_BASE_ID_FUADIJAN, tableKey),
    { fields },
    { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}`, "Content-Type": "application/json" } }
  );
}

async function saveCartToAirtable(restKey, phone, session) {
  const saves = session.cart.map((c) => {
    const payload = {
      phone,
      item: c.item,
      qty: c.qty,
      orderType: session.orderType,
      address: session.address,
      customerName: session.customerName,
    };
    return restKey === "MANDI"
      ? saveRecordToAirtable_MANDI(payload)
      : saveRecordToAirtable_FUADIJAN(payload);
  });

  try {
    await Promise.all(saves);
    return true;
  } catch (e) {
    console.error("Airtable save error:", e?.response?.data || e.message);
    return false;
  }
}

// ====== Webhook (Verify) ======
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ====== Webhook (Receive) ======
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (!messages || messages.length === 0) return res.sendStatus(200);

    const msg = messages[0];
    const from = msg.from;
    const text = (msg.text?.body || "").trim();

    if (!SESSIONS[from]) startSession(from);
    const s = SESSIONS[from];

    // Commands
    if (/^reset$/i.test(text)) {
      resetSession(from);
      await sendText(from, "آپ کی شاپنگ دوبارہ شروع ہو گئی ہے۔\n\n" + restaurantPrompt());
      return res.sendStatus(200);
    }
    if (/^menu$/i.test(text)) {
      s.step = "ASK_RESTAURANT";
      s.cart = [];
      await sendText(from, restaurantPrompt());
      return res.sendStatus(200);
    }

    // Flow
    switch (s.step) {
      case "ASK_RESTAURANT": {
        if (text === "1") s.restaurant = "MANDI";
        else if (text === "2") s.restaurant = "FUADIJAN";
        else {
          await sendText(from, "براہ کرم 1 یا 2 منتخب کریں:\n" + restaurantPrompt());
          break;
        }
        s.step = "ASK_CATEGORY";
        await sendText(from, categoriesPrompt(s.restaurant));
        break;
      }

      case "ASK_CATEGORY": {
        const cat = MENUS[s.restaurant].categories[text];
        if (!cat) {
          await sendText(from, "غلط category کوڈ۔ دوبارہ درج کریں:\n" + categoriesPrompt(s.restaurant));
          break;
        }
        s.category = text;
        s.step = "ASK_ITEM";
        await sendText(from, itemsPrompt(s.restaurant, s.category));
        break;
      }

      case "ASK_ITEM": {
        const cat = MENUS[s.restaurant].categories[s.category];
        const idx = parseInt(text, 10);
        if (Number.isNaN(idx) || idx < 1 || idx > cat.items.length) {
          await sendText(from, "غلط آئٹم نمبر۔ دوبارہ درج کریں:\n" + itemsPrompt(s.restaurant, s.category));
          break;
        }
        s.item = cat.items[idx - 1];
        s.step = "ASK_QTY";
        await sendText(from, "کتنی quantity لینی ہے؟ (مثال: 1، 2، 3)");
        break;
      }

      case "ASK_QTY": {
        const q = parseInt(text, 10);
        if (Number.isNaN(q) || q < 1) {
          await sendText(from, "غلط quantity۔ دوبارہ لکھیں (1 یا اس سے زیادہ)");
          break;
        }
        s.qty = q;
        s.cart.push({ item: s.item, qty: s.qty });
        s.item = null;
        s.qty = null;

        s.step = "ADD_MORE_OR_CHECKOUT";
        await sendText(from, addMoreOrCheckoutPrompt(s.cart));
        break;
      }

      case "ADD_MORE_OR_CHECKOUT": {
        if (text === "1") {
          s.step = "ASK_CATEGORY";
          await sendText(from, categoriesPrompt(s.restaurant));
        } else if (text === "2") {
          s.step = "ASK_ORDER_TYPE";
          await sendText(from, orderTypePrompt());
        } else {
          await sendText(from, "براہ کرم 1 (Add more) یا 2 (Checkout) لکھیں۔\n" + addMoreOrCheckoutPrompt(s.cart));
        }
        break;
      }

      case "ASK_ORDER_TYPE": {
        if (text === "1") {
          s.orderType = "Delivery";
          s.step = "ASK_ADDRESS";
          await sendText(from, "براہ کرم Delivery address لکھیں:");
        } else if (text === "2") {
          s.orderType = "Take-away";
          s.step = "ASK_NAME";
          await sendText(from, "Take-away کے لئے آپ کا نام؟");
        } else if (text === "3") {
          s.orderType = "Dine-in";
          s.step = "ASK_GUESTS";
          await sendText(from, "Dine-in کے لئے مہمانوں کی تعداد لکھیں (مثال: 2):");
        } else {
          await sendText(from, "براہ کرم 1/2/3 میں سے منتخب کریں:\n" + orderTypePrompt());
        }
        break;
      }

      case "ASK_ADDRESS": {
        s.address = text;
        s.step = "CONFIRM_AND_SAVE";
        await handleConfirmAndSave(from, s);
        break;
      }

      case "ASK_NAME": {
        s.customerName = text;
        s.step = "CONFIRM_AND_SAVE";
        await handleConfirmAndSave(from, s);
        break;
      }

      case "ASK_GUESTS": {
        const g = parseInt(text, 10);
        if (Number.isNaN(g) || g < 1) {
          await sendText(from, "غلط نمبر۔ مہمانوں کی صحیح تعداد لکھیں (1 یا زیادہ)");
          break;
        }
        s.guests = g;
        s.step = "CONFIRM_AND_SAVE";
        await handleConfirmAndSave(from, s);
        break;
      }

      default: {
        s.step = "ASK_RESTAURANT";
        await sendText(from, restaurantPrompt());
      }
    }

    res.sendStatus(200);
  } catch (e) {
    console.error("Webhook handler error:", e?.response?.data || e.message);
    res.sendStatus(200);
  }
});

async function handleConfirmAndSave(phone, session) {
  const rName = MENUS[session.restaurant].name;
  const addressLine = session.orderType === "Delivery" ? `\n📍 Address: ${session.address}` : "";
  const nameLine = session.orderType === "Take-away" ? `\n👤 Name: ${session.customerName}` : "";
  const guestsLine = session.orderType === "Dine-in" ? `\n👥 Guests: ${session.guests}` : "";

  const summary =
    `✅ آرڈر کنفرم:\n` +
    `ریسٹورنٹ: ${rName}\n` +
    `آئٹمز:\n${fmtCart(session.cart)}\n` +
    `Order Type: ${session.orderType}` +
    addressLine + nameLine + guestsLine +
    `\n\n💳 ادائیگی: Pay on Counter`;

  await sendText(phone, summary);
  await sendText(phone, "ریکارڈ محفوظ کیا جا رہا ہے…");

  const ok = await saveCartToAirtable(session.restaurant, phone, session);

  if (ok) {
    await sendText(phone, "✅ آرڈر Airtable میں محفوظ ہو گیا ہے۔ شکریہ!");
  } else {
    await sendText(phone, "⚠️ Airtable میں save کرتے وقت مسئلہ آیا۔ براہ کرم بعد میں دوبارہ کوشش کریں یا admin سے رابطہ کریں۔");
  }

  await sendText(phone, "اگر دوبارہ آرڈر کرنا ہو تو 'menu' لکھیں، یا نئی شاپنگ شروع کرنے کیلئے 'reset' لکھیں۔");
  resetSession(phone);
}

// ====== Healthcheck ======
app.get("/", (_req, res) => res.send("OK"));

// ====== Start ======
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
