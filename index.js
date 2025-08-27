// index.js — Restaurant Online Ordering (WhatsApp Cloud API)
// Node 18+ recommended

const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

// ------------ ENV ------------
const {
  ACCESS_TOKEN,
  PHONE_NUMBER_ID,
  VERIFY_TOKEN,

  AIRTABLE_API_KEY,
  AIRTABLE_BASE_ID_MANDI,
  AIRTABLE_TABLE_ID_MANDI,

  AIRTABLE_BASE_ID_FUADIJAN,
  AIRTABLE_TABLE_ID_FUADIJAN,
} = process.env;

// ------------ HELPERS ------------
async function sendText(to, body) {
  const url = `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`;
  await axios.post(
    url,
    { messaging_product: "whatsapp", to, text: { body } },
    { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
  );
}
const BOX = ["0️⃣","1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"];
const box = (n) => BOX[n] || `${n}.`;
const AUD = (n) => `A$${Number(n).toFixed(2)}`;

// ------------ SESSION ------------
const sessions = new Map();
function S(phone) {
  if (!sessions.has(phone)) {
    sessions.set(phone, {
      stage: "WELCOME",
      restaurant: null,
      category: null,
      itemPending: null,
      itemPendingPrice: 0,
      cart: [],
      orderType: null,
      address: null,
      customerName: null,
      guests: null,
    });
  }
  return sessions.get(phone);
}
function reset(p){ sessions.delete(p); }
const cartTotal = (cart)=>cart.reduce((s,c)=>s + c.price * c.qty, 0);

// ------------ MENUS (shortened here, same as before) ------------
const MENUS = {
  MANDI: {
    name: "Mataam Al Arabi",
    tagline: "Authentic Mandi & BBQ Restaurant",
    categories: [
      { code: 1, key: "mandi_single",  title: "Mandi — Single 🍛" },
      { code: 2, key: "mandi_deals",   title: "Mandi Deals 👨‍👩‍👧‍👦" },
      { code: 3, key: "curries",       title: "Curries 🥘" },
      { code: 4, key: "breads",        title: "Bread (Naan) 🍞" },
      { code: 5, key: "desserts",      title: "Desserts 🍨" },
      { code: 6, key: "drinks",        title: "Drinks & Ice Creams 🥤" },
      { code: 7, key: "entree",        title: "Starters / Entree 🍢" },
      { code: 8, key: "lamb_biryani",  title: "Lamb Biryani 🍖" },
      { code: 9, key: "paan",          title: "Paan Corner 🍃" },
    ],
  },
  FUADIJAN: {
    name: "Fuadijan",
    tagline: "Best Pakistani Street Food",
    categories: [
      { code: 1, key: "breakfast", title: "Breakfast 🍳 (till 2PM)" },
      { code: 2, key: "karahi",    title: "Karahi & Nihari 🍲" },
      { code: 3, key: "burgers",   title: "Burgers 🍔" },
      { code: 4, key: "wraps",     title: "Wraps 🌯" },
      { code: 5, key: "snacks",    title: "Snacks & Sides 🍟" },
      { code: 6, key: "plates",    title: "BBQ Plates 🍖" },
      { code: 7, key: "addons",    title: "Add-ons 🧂" },
      { code: 8, key: "desserts",  title: "Desserts 🍰" },
      { code: 9, key: "drinks",    title: "Drinks & Juices 🥤" },
    ],
  },
};

// ------------ TEMPLATES (Welcome spaced, others compact) ------------
function welcome() {
  return [
    "👋 Welcome to the Online Ordering System!",
    "",
    "✨ Please choose a restaurant:",
    "",
    `${box(1)} ${MENUS.MANDI.name} 🍖\n   ${MENUS.MANDI.tagline}`,
    "",
    `${box(2)} ${MENUS.FUADIJAN.name} 🌶️\n   ${MENUS.FUADIJAN.tagline}`,
    "",
    "────────────────────────",
    "",
    "💡 Type the number to continue.",
    "🔄 Send 'menu' anytime to restart, or 'reset' to clear."
  ].join("\n");
}

function categoriesPrompt(restKey) {
  const { name, categories } = MENUS[restKey];
  const rows = categories.map(c => `${box(c.code)} ${c.title}`).join("\n");
  return [
    `📋 ${name}`,
    "────────────────────────",
    "Please choose a category:",
    rows
  ].join("\n");
}

function itemsFor(restKey, menuKey) {
  return []; // keep PRICES here same as before
}
function itemsPrompt(restKey, catCode) {
  const cat = MENUS[restKey].categories.find(c => c.code === catCode);
  const items = itemsFor(restKey, cat.key);
  const rows = items.map((it, idx) => `${box(idx+1)} ${it.label} — ${AUD(it.price)}`).join("\n");
  return [
    `🔎 ${cat.title}`,
    "────────────────────────",
    "Please choose an item:",
    rows
  ].join("\n");
}

function qtyPrompt(item, price) {
  return `How many for “${item}” (${AUD(price)})? Reply with a number (e.g., 1, 2, 3).`;
}

function addOrCheckoutPrompt(cart) {
  const lines = cart.map(
    (c,i)=>`${i+1}) ${c.item} × ${c.qty} = ${AUD(c.price*c.qty)}`
  ).join("\n");
  return [
    "✅ Item added to cart",
    "🛒 Your Cart",
    "────────────────────────",
    lines || "(empty)",
    `Subtotal: ${AUD(cartTotal(cart))}`,
    `${box(1)} Add more items`,
    `${box(2)} Proceed to Checkout`
  ].join("\n");
}

function orderTypePrompt() {
  return [
    "🚚 Choose order type",
    "────────────────────────",
    `${box(1)} Delivery`,
    `${box(2)} Takeaway`,
    `${box(3)} Dine-in`
  ].join("\n");
}

function finalSummary(s) {
  const lines = s.cart.map(
    (c,i)=>`${i+1}) ${c.item} × ${c.qty} = ${AUD(c.price*c.qty)}`
  ).join("\n");
  const total = AUD(cartTotal(s.cart));
  const extra =
    s.orderType === "Delivery" ? `📍 Address: ${s.address}` :
    s.orderType === "Takeaway" ? `👤 Name: ${s.customerName}` :
    `👥 Guests: ${s.guests}`;
  const restName = MENUS[s.restaurant].name;
  return [
    `✅ ${restName} — Order Summary`,
    "────────────────────────",
    lines,
    `Order Type: ${s.orderType}`,
    extra,
    `💰 Grand Total: ${total}`,
    "💳 Payment: Pay on Counter",
    "🙏 Thank you for your order!"
  ].join("\n");
}

// ------------ Airtable + Webhook code ------------
// (same as previous full version, unchanged — just keep your PRICES and saveCart logic)

app.get("/", (_req,res)=>res.send("OK"));
const PORT = process.env.PORT || 8080;
app.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));
