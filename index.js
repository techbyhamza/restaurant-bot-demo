// index.js — Restaurant Online Ordering (WhatsApp Cloud API)

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

// ------------ MENUS + PRICES (SAME AS BEFORE) ------------
const MENUS = { /* ... keep full MENUS here ... */ };
const PRICES = { /* ... keep full PRICES here ... */ };
const KEY_MAP = { /* ... same as before ... */ };

function itemsFor(restKey, menuKey) {
  const effectiveKey = restKey === "FUADIJAN" && KEY_MAP.FUADIJAN[menuKey]
    ? KEY_MAP.FUADIJAN[menuKey]
    : menuKey;
  return PRICES[effectiveKey] || [];
}

// ------------ TEMPLATES ------------
function welcome() {
  return [
    "👋 Welcome to the Online Ordering System!",
    "",
    "✨ Please choose a restaurant:",
    "",
    `${box(1)} ${MENUS.MANDI.name} 🍖`,
    `   ${MENUS.MANDI.tagline}`,
    "",
    `${box(2)} ${MENUS.FUADIJAN.name} 🌶️`,
    `   ${MENUS.FUADIJAN.tagline}`,
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
  return [`📋 ${name}`, "────────────────────────", "Please choose a category:", rows].join("\n");
}
function itemsPrompt(restKey, catCode) {
  const cat = MENUS[restKey].categories.find(c => c.code === catCode);
  const items = itemsFor(restKey, cat.key);
  const rows = items.map((it, idx) => `${box(idx+1)} ${it.label} — ${AUD(it.price)}`).join("\n");
  return [`🔎 ${cat.title}`, "────────────────────────", "Please choose an item:", rows].join("\n");
}
function qtyPrompt(item, price) {
  return `How many for “${item}” (${AUD(price)})? Reply with a number (e.g., 1, 2, 3).`;
}
function addOrCheckoutPrompt(cart) {
  const lines = cart.map((c,i)=>`${i+1}) ${c.item} × ${c.qty} = ${AUD(c.price*c.qty)}`).join("\n");
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
  const lines = s.cart.map((c,i)=>`${i+1}) ${c.item} × ${c.qty} = ${AUD(c.price*c.qty)}`).join("\n");
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
    `Grand Total: ${total}`,
    "💳 Payment: Pay on Counter",
    "🙏 Thank you for your order!"
  ].join("\n");
}

// ------------ AIRTABLE SAVE (same as before) ------------
async function saveToMandi(o){ /* ... same ... */ }
async function saveToFuadijan(o){ /* ... same ... */ }
async function saveCart(restKey, phone, s){ /* ... same ... */ }

// ------------ WEBHOOKS ------------
app.get("/webhook", (req, res) => { /* ... same ... */ });
app.post("/webhook", async (req, res) => { /* ... same main bot flow ... */ });

// ------------ DIAG ROUTES ------------
app.get("/diag/airtable", async (_req, res) => { /* ... same ... */ });

// NEW: Prices diagnostic
app.get("/diag/prices", (_req, res) => {
  try {
    const all = {};
    for (const restKey of Object.keys(MENUS)) {
      all[restKey] = {};
      MENUS[restKey].categories.forEach(cat => {
        const key = restKey === "FUADIJAN" && KEY_MAP.FUADIJAN[cat.key] ? KEY_MAP.FUADIJAN[cat.key] : cat.key;
        all[restKey][cat.title] = PRICES[key] || [];
      });
    }
    res.json({ ok:true, menus: all });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

app.get("/", (_req,res)=>res.send("OK"));
const PORT = process.env.PORT || 8080;
app.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));
