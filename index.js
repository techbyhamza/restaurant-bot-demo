// WhatsApp Restaurant Bot — Two restaurants, both Category-based + Cart + Checkout details
// CommonJS (no "type":"module"), ready for Railway

const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;   // WhatsApp Cloud API token
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const PORT = process.env.PORT || 8080;

/* =============================== DATA =============================== */

// DB field names (Airtable/DB structure)
const DB_FIELDS = {
  CustomerName: "CustomerName",
  PhoneNumber: "PhoneNumber",
  MenuItem: "MenuItem",
  Quantity: "Quantity",
  Address: "Address",
  OrderType: "OrderType",
  OrderTime: "OrderTime",
};

const RESTAURANTS = {
  // ────────────────────────── Mat'am Al Mandi ──────────────────────────
  mandi: {
    title: "Mat'am Al Mandi",
    currency: "AUD",
    categories: [
      {
        id: "mandi_single",
        label: "Mandi – Single",
        emoji: "🍖",
        items: [
          { code: 1, name: "Lamb Mandi (Single)",     price: 20,  emoji: "🍖" },
          { code: 2, name: "Chicken Mandi (Single)",  price: 20,  emoji: "🍗" },
          { code: 3, name: "Chicken 65 Mandi (Single)", price: 22, emoji: "🍗" },
          { code: 4, name: "Chicken Tikka Mandi (Single)", price: 22, emoji: "🍗" },
          { code: 5, name: "Fish Mandi (Single)",     price: 22,  emoji: "🐟" },
        ],
      },
      {
        id: "mandi_meal",
        label: "Mandi – Meal",
        emoji: "🍽️",
        items: [
          { code: 1, name: "Lamb Mandi (Meal)",       price: 30, emoji: "🍖" },
          { code: 2, name: "Chicken Mandi (Meal)",    price: 30, emoji: "🍗" },
          { code: 3, name: "Chicken 65 Mandi (Meal)", price: 30, emoji: "🍗" },
          { code: 4, name: "Chicken Tikka Mandi (Meal)", price: 30, emoji: "🍗" },
          { code: 5, name: "Fish Mandi (Meal)",       price: 30, emoji: "🐟" },
        ],
      },
      {
        id: "curries",
        label: "Curries",
        emoji: "🍲",
        items: [
          { code: 1, name: "Mughlai Mutton",     price: 20, emoji: "🍖" },
          { code: 2, name: "Dum ka Chicken",     price: 20, emoji: "🍗" },
          { code: 3, name: "Lamb Marag Soup",    price: 20, emoji: "🥣" },
          { code: 4, name: "Chicken Kadai",      price: 20, emoji: "🍗" },
          { code: 5, name: "Mutton Masala",      price: 20, emoji: "🍖" },
          { code: 6, name: "Butter Chicken",     price: 20, emoji: "🧈" },
        ],
      },
      {
        id: "breads",
        label: "Bread (Naan)",
        emoji: "🫓",
        items: [
          { code: 1, name: "Plain Naan",        price: 2.5, emoji: "🫓" },
          { code: 2, name: "Butter Naan",       price: 3.0, emoji: "🧈" },
          { code: 3, name: "Cheese Naan",       price: 4.0, emoji: "🧀" },
          { code: 4, name: "Garlic Naan",       price: 4.0, emoji: "🧄" },
          { code: 5, name: "Cheese Garlic Naan",price: 4.5, emoji: "🧀" },
        ],
      },
      {
        id: "desserts",
        label: "Desserts",
        emoji: "🍮",
        items: [
          { code: 1, name: "Fruit Custard",     price: 8.0, emoji: "🍮" },
          { code: 2, name: "Gulab Jamun",       price: 8.0, emoji: "🍮" },
          { code: 3, name: "Sitafal Cream",     price: 8.0, emoji: "🍨" },
          { code: 4, name: "Mango Malai",       price: 8.0, emoji: "🥭" },
          { code: 5, name: "Double ka Mitha",   price: 8.0, emoji: "🍰" },
        ],
      },
    ],
  },

  // ───────────────────────────── Fuadijan ─────────────────────────────
  fuadijan: {
    title: "Fuadijan – Pakistani Street Food",
    currency: "AUD",
    categories: [
      {
        id: "drinks",
        label: "Drinks & Juices",
        emoji: "🥤",
        items: [
          { code: 1, name: "Bert’s Soft Drinks (Bottle)", price: 3.5, emoji: "🥤" },
          { code: 2, name: "Juices (Eastcoast)",          price: 5.0, emoji: "🧃" },
          { code: 3, name: "Milk Shake (Mango)",          price: 9.0, emoji: "🥤" },
          { code: 4, name: "Bert’s 1.25 Ltr Bottle",      price: 6.0, emoji: "🧪" },
          { code: 5, name: "Spring Water / Pakola",       price: 3.0, emoji: "💧" },
        ],
      },
      {
        id: "breakfast",
        label: "Breakfast",
        emoji: "🍳",
        items: [
          { code: 1, name: "Halwa Poori (2)",              price: 14.99, emoji: "🥘" },
          { code: 2, name: "Anda Paratha (2 + Omelette)",  price: 11.99, emoji: "🍳" },
          { code: 3, name: "Anda Bun",                     price: 8.99,  emoji: "🥯" },
          { code: 4, name: "Beef Nihari (Bowl)",           price: 14.99, emoji: "🍲" },
          { code: 5, name: "Karak Chai",                   price: 4.0,   emoji: "☕" },
          { code: 6, name: "Doodh Patti (add-on)",         price: 2.5,   emoji: "🥛" },
        ],
      },
      {
        id: "karahi",
        label: "Karahi & Nihari",
        emoji: "🍲",
        items: [
          { code: 1, name: "Chicken Karahi (Half)",           price: 24.0, emoji: "🍗" },
          { code: 2, name: "Salt & Pepper Lamb Karahi (500g)",price: 30.0, emoji: "🍖" },
          { code: 3, name: "Beef Nihari Plate",               price: 15.0, emoji: "🥘" },
        ],
      },
      {
        id: "burgers",
        label: "Burgers & Wraps",
        emoji: "🍔",
        items: [
          { code: 1, name: "Beef Burger",                              price: 14.0, emoji: "🍔" },
          { code: 2, name: "Chicken Shami Burger",                     price: 11.0, emoji: "🍔" },
          { code: 3, name: "Chicken Tikka Burger",                     price: 13.0, emoji: "🍔" },
          { code: 4, name: "Wrap (Chicken Tikka/Beef Seekh)",          price: 13.0, emoji: "🌯" },
          { code: 5, name: "Veggie Wrap",                              price: 13.0, emoji: "🌯" },
          { code: 6, name: "Dahi Papri Chana Chaat",                   price: 9.5,  emoji: "🥗" },
        ],
      },
      {
        id: "snacks",
        label: "Snack Packs & Chips",
        emoji: "🍟",
        items: [
          { code: 1, name: "Chips (Small)",                    price: 5.0,  emoji: "🍟" },
          { code: 2, name: "Chips (Large)",                    price: 10.0, emoji: "🍟" },
          { code: 3, name: "Chicken Tikka Snack Pack (Small)", price: 10.0, emoji: "🥡" },
          { code: 4, name: "Chicken Tikka Snack Pack (Large)", price: 20.0, emoji: "🥡" },
        ],
      },
      {
        id: "plates",
        label: "Plates (with Naan/Rice)",
        emoji: "🍖",
        items: [
          { code: 1, name: "Chicken Tikka – 2 Skewers", price: 18.0, emoji: "🍗" },
          { code: 2, name: "Chicken Tikka – 3 Skewers", price: 25.0, emoji: "🍗" },
          { code: 3, name: "Chicken Seekh – 2 Skewers", price: 18.0, emoji: "🥙" },
          { code: 4, name: "Chicken Seekh – 3 Skewers", price: 25.0, emoji: "🥙" },
          { code: 5, name: "Lamb Chops – 3 Pieces",     price: 20.0, emoji: "🥩" },
          { code: 6, name: "Beef Seekh – 2 Skewers",    price: 18.0, emoji: "🥓" },
          { code: 7, name: "Beef Chapli Kebab – 1 Kebab", price: 18.0, emoji: "🥘" },
        ],
      },
      {
        id: "addons",
        label: "Add-ons & Breads",
        emoji: "🥗",
        items: [
          { code: 1, name: "Garden Salad",          price: 2.0, emoji: "🥗" },
          { code: 2, name: "Yogurt Sauce",          price: 0.5, emoji: "🥣" },
          { code: 3, name: "Drinks (from)",         price: 3.0, emoji: "🥤" },
          { code: 4, name: "Tandoori Roti",         price: 2.0, emoji: "🫓" },
          { code: 5, name: "Naan / Souvlaki Bread", price: 2.5, emoji: "🫓" },
          { code: 6, name: "Rice (300g)",           price: 3.0, emoji: "🍚" },
        ],
      },
      {
        id: "sweets",
        label: "Sweets",
        emoji: "🍮",
        items: [
          { code: 1, name: "Gulab Jamun (1 pc)", price: 2.0, emoji: "🍮" },
          { code: 2, name: "Kheer (200g)",       price: 6.0, emoji: "🍚" },
        ],
      },
    ],
  },
};

const RESTAURANT_ORDER = ["mandi", "fuadijan"];

/* ============================ SESSIONS ============================ */
// wa_id -> state
// steps: rest, cat, items, qty, more, otype, addr, custname, guests, confirm
const SESS = new Map();
function getS(wa) {
  if (!SESS.has(wa)) {
    SESS.set(wa, {
      step: "rest",
      restaurantKey: null,
      categoryIdx: null,
      itemIdx: null,
      qty: null,
      cart: [],
      orderType: null,   // Delivery / Take-away / Dine-in
      customerName: "",
      address: "",
      guests: null
    });
  }
  return SESS.get(wa);
}
function resetS(wa) {
  SESS.set(wa, {
    step: "rest",
    restaurantKey: null,
    categoryIdx: null,
    itemIdx: null,
    qty: null,
    cart: [],
    orderType: null,
    customerName: "",
    address: "",
    guests: null
  });
}

/* ============================== UI =============================== */
const curf = (n, c = "AUD") => {
  try { return new Intl.NumberFormat("en-AU", { style: "currency", currency: c }).format(n); }
  catch { return `$${n}`; }
};

function restaurantSelectionText() {
  let t = "🍴 Welcome! Please choose a restaurant:\n\n";
  RESTAURANT_ORDER.forEach((key, idx) => {
    const r = RESTAURANTS[key];
    t += `${idx + 1}️⃣  ${r.title}\n`;
  });
  t += `\n👉 Reply with 1 or 2`;
  return t;
}

function categoryText(restKey) {
  const R = RESTAURANTS[restKey];
  let t = `📋 ${R.title} — Choose a category:\n\n`;
  R.categories.forEach((c, i) => { t += `${i + 1}️⃣ ${c.emoji} ${c.label}\n`; });
  t += `\n👉 Reply with a number`;
  return t;
}

function itemsText(restKey, catIdx) {
  const R = RESTAURANTS[restKey];
  const cat = R.categories[catIdx];
  let t = `${cat.emoji} ${R.title} — ${cat.label}\n\n`;
  cat.items.forEach(it => { t += `${it.code}️⃣ ${it.emoji} ${it.name} — ${curf(it.price, R.currency)}\n`; });
  t += `\n👉 Reply with item number\n↩️ Type 0 to go Back`;
  return t;
}

function addMoreText() {
  return "➕ Do you want anything else?\n\n1️⃣ Add more items\n2️⃣ Checkout";
}

function orderTypeText() {
  return "🚚 Choose order type:\n\n1️⃣ Delivery\n2️⃣ Take-away\n3️⃣ Dine-in\n\n👉 Reply with 1, 2, or 3";
}

const addressText     = () => "📍 Please send your full delivery address (street, suburb, postcode).";
const customerNameText= () => "👤 Please send your name for take-away pickup.";
const guestsText      = () => "👥 How many guests for dine-in? (1–20)";

function cartSummary(s) {
  const lines = s.cart.map(ci => `• ${ci.emoji} ${ci.name} x ${ci.qty} — ${curf(ci.price * ci.qty)}`);
  const subtotal = s.cart.reduce((acc, ci) => acc + ci.price * ci.qty, 0);
  return { text: lines.join("\n"), subtotal };
}

function confirmText(s) {
  const { text, subtotal } = cartSummary(s);
  const rTitle = s.cart[0]?.restaurant || "";
  const otDetail =
    s.orderType === "Delivery" ? `Delivery — ${s.address}` :
    s.orderType === "Take-away" ? `Take-away — ${s.customerName || "No name"}` :
    s.orderType === "Dine-in" ? `Dine-in — ${s.guests} guests` : "";
  return (
    `🧾 Order Summary\nRestaurant: ${rTitle}\n\n${text}\n\n` +
    `Order Type: ${otDetail}\nPayment: Pay on Counter\n` +
    `Total: ${curf(subtotal)}\n\n` +
    `✅ Confirm → type *yes*\n❌ Cancel → type *no*`
  );
}

/* ========================== WhatsApp send ========================= */
async function sendText(wa, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
      { messaging_product: "whatsapp", to: wa, text: { body: text } },
      { headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("sendText error:", e.response?.data || e.message);
  }
}

/* ============================ Webhook ============================ */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const msg = value?.messages?.[0];
    if (msg && msg.type === "text") {
      const wa = msg.from;
      const text = (msg.text?.body || "").trim();
      await handleIncoming(wa, text);
    }
    return res.sendStatus(200);
  } catch (e) {
    console.error("webhook error", e);
    return res.sendStatus(500);
  }
});

app.get("/", (_, res) => res.send("OK — Restaurant bot is running"));

/* ============================== Logic ============================ */
function isHello(t) {
  const s = t.toLowerCase();
  return ["hi", "hello", "hey", "start", "menu"].includes(s);
}

async function handleIncoming(wa, text) {
  const s = getS(wa);

  // Global
  if (isHello(text) || text.toLowerCase() === "restart") {
    resetS(wa);
    return sendText(wa, restaurantSelectionText());
  }
  if (text.toLowerCase() === "menu" && s.restaurantKey) {
    s.step = "cat";
    return sendText(wa, categoryText(s.restaurantKey));
  }

  /* Step: choose restaurant */
  if (s.step === "rest") {
    if (/^\d$/.test(text)) {
      const n = parseInt(text, 10);
      if (n >= 1 && n <= RESTAURANT_ORDER.length) {
        s.restaurantKey = RESTAURANT_ORDER[n - 1];
        s.step = "cat";
        return sendText(wa, categoryText(s.restaurantKey));
      }
    }
    return sendText(wa, restaurantSelectionText());
  }

  /* Step: choose category */
  if (s.step === "cat" && s.restaurantKey) {
    if (/^\d$/.test(text)) {
      const idx = parseInt(text, 10) - 1;
      const cats = RESTAURANTS[s.restaurantKey].categories;
      if (idx >= 0 && idx < cats.length) {
        s.categoryIdx = idx;
        s.step = "items";
        return sendText(wa, itemsText(s.restaurantKey, idx));
      }
    }
    return sendText(wa, categoryText(s.restaurantKey));
  }

  /* Step: choose item inside category */
  if (s.step === "items" && s.restaurantKey != null && s.categoryIdx != null) {
    if (text === "0") { s.categoryIdx = null; s.step = "cat"; return sendText(wa, categoryText(s.restaurantKey)); }
    const n = parseInt(text, 10);
    const cat = RESTAURANTS[s.restaurantKey].categories[s.categoryIdx];
    const item = cat.items.find(it => it.code === n);
    if (!item) return sendText(wa, "Please send a valid item number or 0 to go back.");
    s.itemIdx = cat.items.indexOf(item);
    s.step = "qty";
    return sendText(wa, `✅ You selected: ${item.emoji} ${item.name}\nPrice: ${curf(item.price, RESTAURANTS[s.restaurantKey].currency)}\n\nPlease send *quantity* (1–99).`);
  }

  /* Step: quantity → push to cart */
  if (s.step === "qty" && s.itemIdx != null) {
    if (/^\d{1,2}$/.test(text)) {
      const q = parseInt(text, 10);
      if (q >= 1 && q <= 99) {
        const R = RESTAURANTS[s.restaurantKey];
        const cat = R.categories[s.categoryIdx];
        const it  = cat.items[s.itemIdx];
        s.cart.push({ name: it.name, emoji: it.emoji, price: it.price, qty: q, restaurant: R.title, category: cat.label });

        // reset item selection
        s.itemIdx = null; s.qty = null;
        s.step = "more";
        const { text: itemsTxt, subtotal } = cartSummary(s);
        await sendText(wa, `🛒 Cart Updated\n${itemsTxt}\nSubtotal: ${curf(subtotal, R.currency)}\n`);
        return sendText(wa, addMoreText());
      }
    }
    return sendText(wa, "✖️ Please send a valid quantity (1–99).");
  }

  /* Step: add more or checkout */
  if (s.step === "more") {
    if (text === "1") { s.step = "cat"; return sendText(wa, categoryText(s.restaurantKey)); }
    if (text === "2") { s.step = "otype"; return sendText(wa, orderTypeText()); }
    return sendText(wa, addMoreText());
  }

  /* Step: order type and details */
  if (s.step === "otype") {
    if (/^[123]$/.test(text)) {
      const map = { 1: "Delivery", 2: "Take-away", 3: "Dine-in" };
      s.orderType = map[parseInt(text, 10)];
      if (s.orderType === "Delivery")  { s.step = "addr";     return sendText(wa, addressText()); }
      if (s.orderType === "Take-away") { s.step = "custname"; return sendText(wa, customerNameText()); }
      if (s.orderType === "Dine-in")   { s.step = "guests";   return sendText(wa, guestsText()); }
    }
    return sendText(wa, orderTypeText());
  }

  if (s.step === "addr")     { s.address = text;      s.step = "confirm"; return sendText(wa, confirmText(s)); }
  if (s.step === "custname") { s.customerName = text; s.step = "confirm"; return sendText(wa, confirmText(s)); }
  if (s.step === "guests") {
    const g = parseInt(text, 10);
    if (!isNaN(g) && g >= 1 && g <= 20) { s.guests = g; s.step = "confirm"; return sendText(wa, confirmText(s)); }
    return sendText(wa, "Please send a valid number of guests (1–20).");
  }

  /* Step: confirm */
  if (s.step === "confirm") {
    const ans = text.toLowerCase();
    if (ans === "yes") {
      const { subtotal } = cartSummary(s);
      const itemsStr = s.cart.map(ci => `${ci.name} x ${ci.qty}`).join("; ");
      const totalQty = s.cart.reduce((acc, ci) => acc + ci.qty, 0);
      const orderTypeDetail =
        s.orderType === "Delivery" ? `Delivery — ${s.address}` :
        s.orderType === "Take-away" ? `Take-away — ${s.customerName || ""}` :
        s.orderType === "Dine-in" ? `Dine-in — ${s.guests} guests` : "";

      const record = {
        [DB_FIELDS.CustomerName]: s.customerName || "",
        [DB_FIELDS.PhoneNumber]: wa,
        [DB_FIELDS.MenuItem]: itemsStr,
        [DB_FIELDS.Quantity]: totalQty,
        [DB_FIELDS.Address]: s.address || "",
        [DB_FIELDS.OrderType]: orderTypeDetail,
        [DB_FIELDS.OrderTime]: new Date().toISOString(),
      };
      // TODO: saveToAirtable(record)

      await sendText(
        wa,
        `🎉 Order confirmed!\nPayment: Pay on Counter\nTotal: ${curf(subtotal)}\n\n` +
        `Type *menu* to order again or *restart* to switch restaurant.`
      );
      return resetS(wa);
    }
    if (ans === "no") { resetS(wa); return sendText(wa, "❌ Order cancelled.\nType *restart* to start again."); }
    return sendText(wa, "Please reply *yes* to confirm or *no* to cancel.");
  }

  // fallback
  return sendText(wa, "Type *restart* to start over.");
}

/* ============================== Start ============================ */
app.listen(PORT, () => console.log(`✅ Bot running on port ${PORT}`));
