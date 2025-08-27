/* index.js - WhatsApp Cloud API Bot (Mandi + Fuadijan)
 * - English prompts with boxed digits
 * - Smart parsing (1 / 1️⃣ / text keywords)
 * - Buttons for Add-more/Checkout and Order Type
 * - Prices + totals
 * - Airtable Table ID > Name fallback
 * - WHATSAPP_TOKEN or ACCESS_TOKEN fallback
 *
 * ENV needed:
 * PORT=3000
 * VERIFY_TOKEN=...
 * PHONE_NUMBER_ID=...
 * WHATSAPP_TOKEN=... (or ACCESS_TOKEN)
 * ACCESS_TOKEN=...
 *
 * AIRTABLE_API_KEY=pat_xxx
 * AIRTABLE_BASE_ID_MANDI=appXXXXXXXXXXXXXX
 * AIRTABLE_BASE_ID_FUADIJAN=appYYYYYYYYYYYY
 * AIRTABLE_TABLE_ID_MANDI=tblXXXXXXXXXXXX        // preferred
 * AIRTABLE_TABLE_ID_FUADIJAN=tblYYYYYYYYYY       // preferred
 * AIRTABLE_TABLE_MANDI=Orders_mandi              // fallback name
 * AIRTABLE_TABLE_FUADIJAN=Orders_Fuadijan        // fallback name
 */

require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(bodyParser.json());

// ===== ENV =====
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// Prefer WHATSAPP_TOKEN, else ACCESS_TOKEN
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || process.env.ACCESS_TOKEN;

// Airtable
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID_MANDI = process.env.AIRTABLE_BASE_ID_MANDI;
const AIRTABLE_BASE_ID_FUADIJAN = process.env.AIRTABLE_BASE_ID_FUADIJAN;
const AIRTABLE_TABLE_ID_MANDI = process.env.AIRTABLE_TABLE_ID_MANDI;
const AIRTABLE_TABLE_ID_FUADIJAN = process.env.AIRTABLE_TABLE_ID_FUADIJAN;
const AIRTABLE_TABLE_MANDI = process.env.AIRTABLE_TABLE_MANDI;
const AIRTABLE_TABLE_FUADIJAN = process.env.AIRTABLE_TABLE_FUADIJAN;

// ===== WhatsApp helpers =====
const WA_URL = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;

async function sendText(to, body) {
  try {
    await axios.post(
      WA_URL,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body },
      },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("sendText error:", e?.response?.data || e.message);
  }
}

async function sendButtons(to, header, buttons) {
  // buttons: [{id:"btn_id", title:"Button Title"}]
  try {
    await axios.post(
      WA_URL,
      {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: header },
          action: {
            buttons: buttons.map((b) => ({
              type: "reply",
              reply: { id: b.id, title: b.title },
            })),
          },
        },
      },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("sendButtons error:", e?.response?.data || e.message);
  }
}

// ===== Smart input parsing =====
function normalizeAnswer(txt = "") {
  const t = txt.trim().toLowerCase();

  const map = {
    "1": 1, "1️⃣": 1, "one": 1, "01": 1,
    "2": 2, "2️⃣": 2, "two": 2, "02": 2,
    "3": 3, "3️⃣": 3, "three": 3, "03": 3,
    "4": 4, "4️⃣": 4, "four": 4, "04": 4,
    "5": 5, "5️⃣": 5, "five": 5, "05": 5,
    "6": 6, "6️⃣": 6, "six": 6, "06": 6,
    "7": 7, "7️⃣": 7, "seven": 7, "07": 7,
    "8": 8, "8️⃣": 8, "eight": 8, "08": 8,
    "9": 9, "9️⃣": 9, "nine": 9, "09": 9,
  };
  if (map[t] != null) return map[t];

  // Keyword aids (tune as needed)
  if (["rice", "mandi rice", "single"].includes(t)) return 1;
  if (["chicken", "chicken mandi", "meal"].includes(t)) return 2;
  if (["curries", "curry"].includes(t)) return 3;
  if (["breads", "bread", "naan"].includes(t)) return 4;
  if (["desserts", "dessert", "sweet"].includes(t)) return 5;

  const n = parseInt(t, 10);
  if (!Number.isNaN(n)) return n;
  return null;
}

// ===== Sessions =====
const SESSIONS = {}; // { phone: { step, restaurant, category, item, itemPrice, qty, cart:[], orderType, address, customerName, guests } }

function startSession(phone) {
  SESSIONS[phone] = {
    step: "ASK_RESTAURANT",
    restaurant: null,
    category: null,
    item: null,
    itemPrice: null,
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

// ===== Menus with prices =====
const MENUS = {
  MANDI: {
    name: "Mat’am Al Mandi",
    categories: {
      "1": { name: "Mandi – Single (Rice)", items: [
        { name: "Chicken Mandi", price: 12.99 },
        { name: "Lamb Mandi",    price: 14.99 },
        { name: "Mix Mandi",     price: 16.99 },
      ]},
      "2": { name: "Mandi – Meal (Chicken)", items: [
        { name: "Chicken Mandi Meal", price: 15.99 },
        { name: "Lamb Mandi Meal",    price: 18.49 },
      ]},
      "3": { name: "Curries", items: [
        { name: "Chicken Curry", price: 11.49 },
        { name: "Mutton Curry",  price: 13.49 },
        { name: "Daal",          price: 7.99 },
      ]},
      "4": { name: "Breads", items: [
        { name: "Roti",    price: 1.50 },
        { name: "Naan",    price: 2.00 },
        { name: "Paratha", price: 2.50 },
      ]},
      "5": { name: "Desserts", items: [
        { name: "Kheer",        price: 4.99 },
        { name: "Gulab Jamun",  price: 5.49 },
      ]},
    },
  },
  FUADIJAN: {
    name: "Fuadijan",
    categories: {
      "1": { name: "Drinks", items: [
        { name: "Water",       price: 1.50 },
        { name: "Cola",        price: 2.50 },
        { name: "Mango Lassi", price: 4.50 },
      ]},
      "2": { name: "Breakfast", items: [
        { name: "Omelette",     price: 6.99 },
        { name: "Paratha Roll", price: 5.99 },
      ]},
      "3": { name: "Karahi & Nihari", items: [
        { name: "Chicken Karahi", price: 14.99 },
        { name: "Beef Nihari",    price: 15.99 },
      ]},
      "4": { name: "Burgers & Wraps", items: [
        { name: "Zinger Burger",  price: 8.99 },
        { name: "Chicken Wrap",   price: 7.99 },
      ]},
      "5": { name: "Snacks", items: [
        { name: "Fries",   price: 3.49 },
        { name: "Samosa",  price: 2.49 },
        { name: "Pakora",  price: 3.49 },
      ]},
      "6": { name: "Plates", items: [
        { name: "Biryani Plate", price: 10.99 },
        { name: "Grill Plate",   price: 12.99 },
      ]},
      "7": { name: "Add-ons", items: [
        { name: "Raita", price: 1.00 },
        { name: "Salad", price: 1.50 },
      ]},
      "8": { name: "Sweets", items: [
        { name: "Jalebi",    price: 4.49 },
        { name: "Ras Malai", price: 5.49 },
      ]},
    },
  },
};

// ===== UI prompts (boxed digits) =====
function restaurantPrompt() {
  return (
`Please select a restaurant:

1️⃣  Mat’am Al Mandi
2️⃣  Fuadijan

You can type the number (1/2) or tap the digit.
Type *reset* anytime to start over.`
  );
}

function categoriesPrompt(restKey) {
  const r = MENUS[restKey];

  if (restKey === "MANDI") {
    return (
`You selected *${r.name}*. Choose a category:

1️⃣  Mandi – Single (Rice)
2️⃣  Mandi – Meal (Chicken)
3️⃣  Curries
4️⃣  Breads
5️⃣  Desserts

Reply with the number (e.g., 1).`
    );
  }

  return (
`You selected *${r.name}*. Choose a category:

1️⃣  Drinks
2️⃣  Breakfast
3️⃣  Karahi & Nihari
4️⃣  Burgers & Wraps
5️⃣  Snacks
6️⃣  Plates
7️⃣  Add-ons
8️⃣  Sweets

Reply with the number (e.g., 1).`
  );
}

function itemsPrompt(restKey, catCode) {
  const cat = MENUS[restKey].categories[catCode];
  if (!cat) return "Invalid category. Please try again.";
  const lines = cat.items
    .map((it, idx) => `${idx + 1}️⃣  ${it.name} — $${it.price.toFixed(2)}`)
    .join("\n");

  return (
`*${cat.name}* — select an item:

${lines}

Reply with the number (e.g., 1).`
  );
}

function fmtCart(cart) {
  if (!cart || cart.length === 0) return "—";
  return cart.map((c, i) => {
    const lineTotal = c.price * c.qty;
    return `${i + 1}) ${c.item} × ${c.qty} — $${lineTotal.toFixed(2)}`;
  }).join("\n");
}
function calcTotal(cart) {
  return cart.reduce((sum, c) => sum + (c.price * c.qty), 0);
}

function addMoreOrCheckoutPrompt(cart) {
  const total = calcTotal(cart);
  return (
`Your cart:
${fmtCart(cart)}

*Total:* $${total.toFixed(2)}

1️⃣  Add more
2️⃣  Checkout

Reply 1 or 2.`
  );
}

function orderTypePrompt() {
  return (
`Select order type:

1️⃣  Delivery
2️⃣  Take-away
3️⃣  Dine-in

Reply 1/2/3 or tap a digit.`
  );
}

// ===== Airtable helper =====
function tableKey(id, name) { return id || name; }
function airtableUrl(baseId, key) {
  return `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(key)}`;
}
const AX_HEADERS = {
  Authorization: `Bearer ${AIRTABLE_API_KEY}`,
  "Content-Type": "application/json",
};

// ===== Airtable save (match your columns exactly) =====
async function saveRecordToAirtable_MANDI(data) {
  const key = tableKey(AIRTABLE_TABLE_ID_MANDI, AIRTABLE_TABLE_MANDI);
  const fields = {
    "Phone Number": data.phone,
    "Order Item": data.item,
    "Quantity": String(data.qty),
    "Order Type": data.orderType,
    "Address": data.address || "",
    "Status": "Pending",
    "Order Time": new Date().toISOString(),
    // Required field in your table:
    "Attachment": [{ url: "https://via.placeholder.com/150" }],
  };
  return axios.post(airtableUrl(AIRTABLE_BASE_ID_MANDI, key), { fields }, { headers: AX_HEADERS });
}

async function saveRecordToAirtable_FUADIJAN(data) {
  const key = tableKey(AIRTABLE_TABLE_ID_FUADIJAN, AIRTABLE_TABLE_FUADIJAN);
  const fields = {
    "CustomerName": data.customerName || "",
    "PhoneNumber": data.phone,
    "MenuItem": data.item,
    "Quantity": String(data.qty),
    "OrderType": data.orderType,
    "Address": data.address || "",
    "OrderTime": new Date().toISOString(),
  };
  return axios.post
