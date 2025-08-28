// index.js — Restaurant Online Ordering (WhatsApp Cloud API)
// Node 18+

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
      cart: [], // [{item, price, qty}]
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

// ------------ MENUS + PRICES -------------
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
      { code: 6, key: "plates",    title: "BBQ Plates 🍖 (incl. naan or rice)" },
      { code: 7, key: "addons",    title: "Add-ons 🧂" },
      { code: 8, key: "desserts",  title: "Desserts 🍰" },
      { code: 9, key: "drinks",    title: "Drinks & Juices 🥤" },
    ],
  },
};

// PRICES
const PRICES = {
  // ----- Mataam Al Arabi -----
  mandi_single: [
    { label: "Lamb Mandi", price: 22 },
    { label: "Chicken Mandi", price: 22 },
    { label: "Chicken Tikka Mandi", price: 22 },
    { label: "Fish Mandi", price: 22 },
    { label: "Mutton Masala Mandi", price: 30 },
    { label: "Lamb Ribs Mandi", price: 30 },
    { label: "Mandi Rice", price: 10 },
  ],
  mandi_deals: [
    { label: "Mix Mandi Deal", price: 50 },
    { label: "Mix Mandi Deal with Fish", price: 58 },
    { label: "Family Mandi Meal (Medium)", price: 90 },
    { label: "Family Mandi Meal (Large)", price: 120 },
    { label: "Special Family Mandi", price: 125 },
    { label: "Whole Lamb Mandi (pre-order)", price: 600 },
  ],
  curries: [
    { label: "Muglai Mutton", price: 20 },
    { label: "Dum ka Chicken", price: 20 },
    { label: "Lamb Marag Soup", price: 20 },
    { label: "Chicken Kadai", price: 20 },
    { label: "Mutton Masala", price: 20 },
    { label: "Butter Chicken", price: 20 },
  ],
  breads: [
    { label: "Plain Naan", price: 2.5 },
    { label: "Butter Naan", price: 3 },
    { label: "Cheese Naan", price: 4 },
    { label: "Garlic Naan", price: 4 },
    { label: "Cheese Garlic Naan", price: 4.5 },
  ],
  desserts: [
    { label: "Fruit Custard", price: 8 },
    { label: "Gulab Jamun", price: 8 },
    { label: "Sitafal Cream", price: 8 },
    { label: "Mango Malai", price: 8 },
    { label: "Double ka Meetha", price: 8 },
  ],
  drinks: [
    { label: "Coke / Fanta / Sprite (can)", price: 3 },
    { label: "Water", price: 3 },
    { label: "Mango Lassi", price: 7 },
    { label: "Kulfi", price: 5 },
    { label: "Mix Ice Cream (cup)", price: 5 },
  ],
  entree: [
    { label: "Chicken 65", price: 20 },
    { label: "Seekh Kebab", price: 20 },
    { label: "Malai Tikka", price: 20 },
    { label: "Fish Fry", price: 20 },
    { label: "Chicken Tikka", price: 20 },
    { label: "Chicken Tandoori", price: 20 },
    { label: "Chips & Nuggets", price: 12 },
  ],
  lamb_biryani: [
    { label: "Sufiyani Biryani", price: 20 },
    { label: "Mughal Biryani", price: 20 },
    { label: "Special Family Biryani", price: 45 },
  ],
  paan: [
    { label: "Sweet Paan", price: 5 },
    { label: "Meenakshi Paan", price: 6 },
    { label: "Saada Paan", price: 5 },
  ],

  // ----- Fuadijan -----
  breakfast: [
    { label: "Anda Bun", price: 8.99 },
    { label: "Anda Paratha", price: 11.99 },
    { label: "Halwa Poori", price: 14.99 },
    { label: "Doodh Patti Chai", price: 2.5 },
    { label: "Beef Nihari", price: 14.99 },
  ],
  karahi: [
    { label: "Chicken Karahi (Half)", price: 24 },
    { label: "Beef Nihari Plate", price: 15 },
  ],
  burgers: [
    { label: "Beef Burger", price: 14 },
    { label: "Chicken Shami Burger", price: 11 },
    { label: "Chicken Tikka Burger", price: 13 },
  ],
  wraps: [
    { label: "Wrap (Chicken Tikka or Beef Seekh)", price: 13 },
    { label: "Veggie Wrap", price: 13 },
  ],
  snacks: [
    { label: "Crispy Hot Chips (Small)", price: 5 },
    { label: "Crispy Hot Chips (Large)", price: 10 },
    { label: "Chicken Tikka Snack Pack (Small)", price: 10 },
    { label: "Chicken Tikka Snack Pack (Large)", price: 20 },
  ],
  plates: [
    { label: "Chicken Tikka — 2 Skewers", price: 18 },
    { label: "Chicken Tikka — 3 Skewers", price: 25 },
    { label: "Chicken Seekh — 2 Skewers", price: 18 },
    { label: "Chicken Seekh — 3 Skewers", price: 25 },
    { label: "Beef Seekh — 2 Skewers", price: 18 },
    { label: "Beef Seekh — 3 Skewers", price: 25 },
    { label: "Beef Chapli Kebab — 1", price: 10 },
    { label: "Lamb Chops — 3 pieces", price: 20 },
  ],
  addons: [
    { label: "Garden Salad", price: 2 },
    { label: "Yogurt Sauce", price: 2 },
    { label: "Tandoori Roti", price: 3 },
    { label: "Naan", price: 3 },
    { label: "Rice", price: 3.5 },
  ],
  desserts_fuadijan: [
    { label: "Gulab Jamun (1 pc)", price: 2 },
    { label: "Kheer (200 gms)", price: 6 },
  ],
  drinks_fuadijan: [
    { label: "Milk Shake", price: 9 },
    { label: "Juices", price: 5 },
    { label: "Pakola", price: 3 },
    { label: "1.25L Soft Drink", price: 6 },
    { label: "Water", price: 3 },
  ],
};

// Map for Fuadijan special keys
const KEY_MAP = {
  MANDI: {},
  FUADIJAN: {
    desserts: "desserts_fuadijan",
    drinks: "drinks_fuadijan",
  },
};

function itemsFor(restKey, menuKey) {
  const effectiveKey = restKey === "FUADIJAN" && KEY_MAP.FUADIJAN[menuKey]
    ? KEY_MAP.FUADIJAN[menuKey]
    : menuKey;
  return PRICES[effectiveKey] || [];
}

// ------------ TEMPLATES (Welcome spaced, others compact) ------------
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
  return [
    `📋 ${name}`,
    "────────────────────────",
    "Please choose a category:",
    rows
  ].join("\n");
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
    `Grand Total: ${total}`,
    "💳 Payment: Pay on Counter",
    "🙏 Thank you for your order!"
  ].join("\n");
}

// ------------ AIRTABLE ------------
async function saveToMandi({ phone, item, qty, orderType, address, price }) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID_MANDI}/${AIRTABLE_TABLE_ID_MANDI}`;
  const headers = { Authorization: `Bearer ${AIRTABLE_API_KEY}`, "Content-Type": "application/json" };
  const fields = {
    "Phone Number": phone,
    "Order Item": `${item} (${AUD(price)})`,
    "Quantity": qty,
    "Address": address || "",
    "Status": "Pending",
    "Order Type": orderType || "",
    "Order Time": new Date().toISOString(),
  };
  return axios.post(url, { fields }, { headers });
}
async function saveToFuadijan({ phone, item, qty, orderType, address, customerName, price }) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID_FUADIJAN}/${AIRTABLE_TABLE_ID_FUADIJAN}`;
  const headers = { Authorization: `Bearer ${AIRTABLE_API_KEY}`, "Content-Type": "application/json" };
  const fields = {
    "CustomerName": customerName || "",
    "PhoneNumber": phone,
    "MenuItem": `${item} (${AUD(price)})`,
    "Quantity": qty,
    "Address": address || "",
    "OrderType": orderType || "",
    "OrderTime": new Date().toISOString(),
  };
  return axios.post(url, { fields }, { headers });
}
async function saveCart(restKey, phone, s) {
  try {
    const tasks = s.cart.map(c => {
      const common = {
        phone, item: c.item, qty: c.qty, orderType: s.orderType,
        address: s.address, customerName: s.customerName, price: c.price
      };
      return restKey === "MANDI" ? saveToMandi(common) : saveToFuadijan(common);
    });
    await Promise.all(tasks);
    return { ok: true };
  } catch (e) {
    const data = e?.response?.data || e.message || "Unknown error";
    console.error("Airtable error:", data);
    const msg = typeof data === "string" ? data : (data?.error?.message || JSON.stringify(data).slice(0, 400));
    return { ok: false, msg };
  }
}

// ------------ WEBHOOK VERIFY ------------
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// ------------ WEBHOOK RECEIVE ------------
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const msg = change?.value?.messages?.[0];
    const phone = msg?.from;

    res.sendStatus(200); // ACK early

    if (!phone || !msg?.text?.body) return;
    const textRaw = msg.text.body.trim();
    const text = textRaw.toLowerCase();

    // shortcuts
    if (text === "reset") { reset(phone); await sendText(phone, "Session cleared. Type 'menu' to start again."); return; }
    if (["menu","hi","hello","start"].includes(text)) { reset(phone); const s = S(phone); s.stage="RESTAURANT"; await sendText(phone, welcome()); return; }

    const s = S(phone);

    // Welcome → Restaurant
    if (s.stage === "WELCOME") { s.stage="RESTAURANT"; await sendText(phone, welcome()); return; }

    // Restaurant
    if (s.stage === "RESTAURANT") {
      if (text === "1") s.restaurant = "MANDI";
      else if (text === "2") s.restaurant = "FUADIJAN";
      else { await sendText(phone, "Please pick 1 or 2.\n\n" + welcome()); return; }
      s.stage = "CATEGORY";
      await sendText(phone, categoriesPrompt(s.restaurant));
      return;
    }

    // Category
    if (s.stage === "CATEGORY") {
      const n = parseInt(text, 10);
      const cat = MENUS[s.restaurant].categories.find(c => c.code === n);
      if (!cat) { await sendText(phone, "Please pick a valid category number.\n\n" + categoriesPrompt(s.restaurant)); return; }
      s.category = cat.code;
      s.stage = "ITEM";
      await sendText(phone, itemsPrompt(s.restaurant, s.category));
      return;
    }

    // Item
    if (s.stage === "ITEM") {
      const idx = parseInt(text, 10);
      const cat = MENUS[s.restaurant].categories.find(c => c.code === s.category);
      const items = itemsFor(s.restaurant, cat.key);
      const picked = items[idx - 1];
      if (!picked) { await sendText(phone, "Please pick a valid item number.\n\n" + itemsPrompt(s.restaurant, s.category)); return; }
      s.itemPending = picked.label;
      s.itemPendingPrice = picked.price;
      s.stage = "QTY";
      await sendText(phone, qtyPrompt(picked.label, picked.price));
      return;
    }

    // Quantity
    if (s.stage === "QTY") {
      const q = parseInt(text, 10);
      if (!Number.isInteger(q) || q <= 0) { await sendText(phone, "Please send a whole number like 1, 2, 3."); return; }
      s.cart.push({ item: s.itemPending, price: s.itemPendingPrice, qty: q });
      s.itemPending = null; s.itemPendingPrice = 0;
      s.stage = "ADD_OR_CHECKOUT";
      await sendText(phone, addOrCheckoutPrompt(s.cart));
      return;
    }

    // Add more / Checkout
    if (s.stage === "ADD_OR_CHECKOUT") {
      if (text === "1") { s.stage="CATEGORY"; await sendText(phone, categoriesPrompt(s.restaurant)); }
      else if (text === "2") { s.stage="ORDER_TYPE"; await sendText(phone, orderTypePrompt()); }
      else { await sendText(phone, "Please send 1 (Add more) or 2 (Checkout)."); }
      return;
    }

    // Order type
    if (s.stage === "ORDER_TYPE") {
      if (text === "1") { s.orderType="Delivery"; s.stage="ADDRESS"; await sendText(phone, "Please share your delivery address."); return; }
      if (text === "2") { s.orderType="Takeaway"; s.stage="NAME";    await sendText(phone, "Please share your name for pick-up.");   return; }
      if (text === "3") { s.orderType="Dine-in";  s.stage="GUESTS";  await sendText(phone, "How many guests? Send a number.");       return; }
      await sendText(phone, "Please choose 1, 2 or 3.\n\n" + orderTypePrompt());
      return;
    }

    // Collect details
    if (s.stage === "ADDRESS") { s.address = textRaw; s.stage="CONFIRM"; }
    if (s.stage === "NAME")    { s.customerName = textRaw; s.stage="CONFIRM"; }
    if (s.stage === "GUESTS")  {
      const g = parseInt(text, 10);
      if (!Number.isInteger(g) || g <= 0) { await sendText(phone, "Please send a valid number of guests."); return; }
      s.guests = g; s.stage="CONFIRM";
    }

    // Confirm + Save
    if (s.stage === "CONFIRM") {
      await sendText(phone, finalSummary(s));
      await sendText(phone, "Saving your order…");
      const result = await saveCart(s.restaurant, phone, s);
      if (result.ok) {
        await sendText(phone, "✅ Saved to Airtable. Thank you!\n\nType 'menu' to order again, or 'reset' to start fresh.");
      } else {
        await sendText(phone, "⚠️ Error saving to Airtable:\n" + result.msg + "\n\nType 'menu' to try again, or 'reset' to start fresh.");
      }
      reset(phone);
      return;
    }
  } catch (e) {
    console.error("Webhook error:", e?.response?.data || e.message);
  }
});

// ------------ OPTIONAL DIAG ------------
app.get("/diag/airtable", async (_req, res) => {
  try {
    const headers = { Authorization: `Bearer ${AIRTABLE_API_KEY}`, "Content-Type": "application/json" };
    const now = new Date().toISOString();
    const mUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID_MANDI}/${AIRTABLE_TABLE_ID_MANDI}`;
    const fUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID_FUADIJAN}/${AIRTABLE_TABLE_ID_FUADIJAN}`;

    const m = await axios.post(mUrl, { fields: {
      "Phone Number": "+61400000000", "Order Item": "DIAG — Chicken Mandi (A$22.00)",
      "Quantity": 1, "Address": "Diag Street", "Status": "Pending", "Order Type": "Delivery", "Order Time": now
    }}, { headers });
    const f = await axios.post(fUrl, { fields: {
      "CustomerName": "Diag User", "PhoneNumber": "+61400000000", "MenuItem": "DIAG — Beef Burger (A$14.00)",
      "Quantity": 1, "Address": "Diag Street", "OrderType": "Takeaway", "OrderTime": now
    }}, { headers });

    await axios.delete(`${mUrl}/${m.data.id}`, { headers });
    await axios.delete(`${fUrl}/${f.data.id}`, { headers });

    res.json({ ok:true });
  } catch (e) {
    res.status(500).json({ ok:false, error: e?.response?.data || e.message });
  }
});

app.get("/", (_req, res) => res.send("OK"));
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
