// index.js — Restaurant WhatsApp Bot (Hamza)
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

// ------------ WHATSAPP HELPERS ------------
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

function withChoices(title, rows) {
  return [title, "", ...rows].join("\n");
}

// ------------ SESSION (in-memory) ------------
const sessions = new Map();
function S(phone) {
  if (!sessions.has(phone)) {
    sessions.set(phone, {
      stage: "WELCOME",
      restaurant: null,     // "MANDI" | "FUADIJAN"
      category: null,       // category code
      itemPending: null,    // item label while asking qty
      cart: [],             // [{item, qty}]
      orderType: null,      // Delivery | Takeaway | Dine-in
      address: null,
      customerName: null,
      guests: null,
    });
  }
  return sessions.get(phone);
}
function reset(phone) { sessions.delete(phone); }

// ------------ MENUS ------------
const MENUS = {
  MANDI: {
    name: "Mataam Al Arabi",
    tagline: "Authentic Mandi & BBQ Restaurant",
    categories: [
      { code: 1, title: "Mandi — Single 🍛", items: [
        "Lamb Mandi", "Chicken Mandi", "Chicken Tikka Mandi",
        "Fish Mandi", "Mutton Masala Mandi", "Lamb Ribs Mandi", "Mandi Rice"
      ]},
      { code: 2, title: "Mandi Deals 👨‍👩‍👧‍👦", items: [
        "Mix Mandi Deal", "Mix Mandi Deal with Fish",
        "Family Mandi Meal (Medium)", "Family Mandi Meal (Large)",
        "Special Family Mandi", "Whole Lamb Mandi (pre-order)"
      ]},
      { code: 3, title: "Curries 🥘", items: [
        "Muglai Mutton", "Dum ka Chicken", "Lamb Marag Soup",
        "Chicken Kadai", "Mutton Masala", "Butter Chicken"
      ]},
      { code: 4, title: "Bread (Naan) 🍞", items: [
        "Plain Naan", "Butter Naan", "Cheese Naan", "Garlic Naan", "Cheese Garlic Naan"
      ]},
      { code: 5, title: "Desserts 🍨", items: [
        "Fruit Custard", "Gulab Jamun", "Sitafal Cream", "Mango Malai", "Double ka Meetha"
      ]},
      { code: 6, title: "Drinks & Ice Creams 🥤", items: [
        "Coke / Fanta / Sprite (can)", "Water", "Mango Lassi",
        "Kulfi", "Mix Ice Cream (cup)"
      ]},
      { code: 7, title: "Starters / Entree 🍢", items: [
        "Chicken 65", "Seekh Kebab", "Malai Tikka", "Fish Fry", "Chicken Tikka", "Chicken Tandoori", "Chips & Nuggets"
      ]},
      { code: 8, title: "Lamb Biryani 🍖", items: [
        "Sufiyani Biryani", "Mughal Biryani", "Special Family Biryani"
      ]},
      { code: 9, title: "Paan Corner 🍃", items: [
        "Sweet Paan", "Meenakshi Paan", "Saada Paan"
      ]},
    ],
  },

  FUADIJAN: {
    name: "Fuadijan",
    tagline: "Best Pakistani Street Food",
    categories: [
      { code: 1, title: "Breakfast 🍳 (till 2PM)", items: [
        "Anda Bun", "Anda Paratha", "Halwa Poori", "Doodh Patti Chai", "Beef Nihari"
      ]},
      { code: 2, title: "Karahi & Nihari 🍲", items: [
        "Chicken Karahi (Half)", "Beef Nihari Plate"
      ]},
      { code: 3, title: "Burgers 🍔", items: [
        "Beef Burger", "Chicken Shami Burger", "Chicken Tikka Burger"
      ]},
      { code: 4, title: "Wraps 🌯", items: [
        "Wrap (choose Chicken Tikka or Beef Seekh)", "Veggie Wrap"
      ]},
      { code: 5, title: "Snacks & Sides 🍟", items: [
        "Crispy Hot Chips (Small)", "Crispy Hot Chips (Large)",
        "Chicken Tikka Snack Pack (Small)", "Chicken Tikka Snack Pack (Large)"
      ]},
      { code: 6, title: "BBQ Plates 🍖 (incl. naan or rice)", items: [
        "Chicken Tikka — 2 Skewers", "Chicken Tikka — 3 Skewers",
        "Chicken Seekh — 2 Skewers", "Chicken Seekh — 3 Skewers",
        "Beef Seekh — 2 Skewers", "Beef Seekh — 3 Skewers",
        "Beef Chapli Kebab — 1", "Lamb Chops — 3 pieces"
      ]},
      { code: 7, title: "Add-ons 🧂", items: [
        "Garden Salad", "Yogurt Sauce", "Tandoori Roti", "Naan", "Rice"
      ]},
      { code: 8, title: "Desserts 🍰", items: [
        "Gulab Jamun", "Kheer"
      ]},
      { code: 9, title: "Drinks & Juices 🥤", items: [
        "Milk Shake", "Juices", "Pakola", "1.25L Soft Drink", "Water"
      ]},
    ],
  },
};

// ------------ TEMPLATES ------------
function welcome() {
  return withChoices(
    "👋 Welcome to our Online Ordering Bot!\nSelect your restaurant:",
    [
      `${box(1)} ${MENUS.MANDI.name} 🍖 — ${MENUS.MANDI.tagline}`,
      `${box(2)} ${MENUS.FUADIJAN.name} 🌶️ — ${MENUS.FUADIJAN.tagline}`,
      "",
      "Type the number. Send 'menu' anytime to restart, or 'reset' to clear."
    ]
  );
}

function categoriesPrompt(restKey) {
  const { name, categories } = MENUS[restKey];
  const rows = categories.map(c => `${box(c.code)} ${c.title}`);
  return withChoices(`📋 ${name} — choose a category:`, rows);
}

function itemsPrompt(restKey, catCode) {
  const { categories } = MENUS[restKey];
  const cat = categories.find(c => c.code === catCode);
  const rows = cat.items.map((label, idx) => `${box(idx+1)} ${label}`);
  return withChoices(`🔎 ${cat.title}\nSelect an item:`, rows);
}

function qtyPrompt(item) {
  return `How many for “${item}”? Reply with a number (e.g., 1, 2, 3).`;
}

function addOrCheckoutPrompt(cart) {
  const list = cart.map((c, i) => `${i+1}) ${c.item} × ${c.qty}`).join("\n");
  return withChoices(
    `Added to cart ✅\n\n🛒 Cart:\n${list || "(empty)"}`,
    [
      `${box(1)} Add more`,
      `${box(2)} Checkout`,
    ]
  );
}

function orderTypePrompt() {
  return withChoices("Choose order type:", [
    `${box(1)} Delivery 🚚`,
    `${box(2)} Takeaway 📦`,
    `${box(3)} Dine-in 🍽️`,
  ]);
}

function finalSummary(s) {
  const lines = s.cart.map((c, i) => `${i+1}) ${c.item} × ${c.qty}`).join("\n");
  const extra =
    s.orderType === "Delivery" ? `\n📍 Address: ${s.address}` :
    s.orderType === "Takeaway" ? `\n👤 Name: ${s.customerName}` :
    `\n👥 Guests: ${s.guests}`;

  const restName = MENUS[s.restaurant].name;
  return [
    `✅ ${restName} — Order Summary`,
    lines,
    `\nOrder Type: ${s.orderType}`,
    extra,
    "\n💳 Payment: Pay on Counter",
  ].join("\n");
}

// ------------ AIRTABLE ------------
async function saveToMandi({ phone, item, qty, orderType, address }) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID_MANDI}/${AIRTABLE_TABLE_ID_MANDI}`;
  const headers = { Authorization: `Bearer ${AIRTABLE_API_KEY}`, "Content-Type": "application/json" };
  const fields = {
    "Phone Number": phone,
    "Order Item": item,
    "Quantity": qty,
    "Address": address || "",
    "Status": "Pending",
    "Order Type": orderType || "",
    "Order Time": new Date().toISOString(),
  };
  return axios.post(url, { fields }, { headers });
}

async function saveToFuadijan({ phone, item, qty, orderType, address, customerName }) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID_FUADIJAN}/${AIRTABLE_TABLE_ID_FUADIJAN}`;
  const headers = { Authorization: `Bearer ${AIRTABLE_API_KEY}`, "Content-Type": "application/json" };
  const fields = {
    "CustomerName": customerName || "",
    "PhoneNumber": phone,
    "MenuItem": item,
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
      const common = { phone, item: c.item, qty: c.qty, orderType: s.orderType, address: s.address, customerName: s.customerName };
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
    res.sendStatus(200);

    if (!phone || !msg?.text?.body) return;
    const textRaw = msg.text.body.trim();
    const text = textRaw.toLowerCase();

    // global commands
    if (text === "reset") { reset(phone); await sendText(phone, "Session cleared. Type 'menu' to start again."); return; }
    if (["menu","hi","hello","start"].includes(text)) { reset(phone); const s = S(phone); s.stage="RESTAURANT"; await sendText(phone, welcome()); return; }
    if (text === "back") {
      const s = S(phone);
      if (s.stage === "ITEM") { s.stage="CATEGORY"; await sendText(phone, categoriesPrompt(s.restaurant)); return; }
      if (s.stage === "QTY")  { s.stage="ITEM";     await sendText(phone, itemsPrompt(s.restaurant, s.category)); return; }
      if (s.stage === "ADD_OR_CHECKOUT") { s.stage="CATEGORY"; await sendText(phone, categoriesPrompt(s.restaurant)); return; }
      await sendText(phone, "Back not available here. Send 'menu' to restart.");
      return;
    }

    const s = S(phone);

    // Welcome → Restaurant
    if (s.stage === "WELCOME") {
      s.stage = "RESTAURANT";
      await sendText(phone, welcome());
      return;
    }

    // Restaurant selection
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
      const label = cat?.items[idx - 1];
      if (!label) { await sendText(phone, "Please pick a valid item number.\n\n" + itemsPrompt(s.restaurant, s.category)); return; }
      s.itemPending = label;
      s.stage = "QTY";
      await sendText(phone, qtyPrompt(label));
      return;
    }

    // Quantity
    if (s.stage === "QTY") {
      const q = parseInt(text, 10);
      if (!Number.isInteger(q) || q <= 0) { await sendText(phone, "Please send a whole number like 1, 2, 3."); return; }
      s.cart.push({ item: s.itemPending, qty: q });
      s.itemPending = null;
      s.stage = "ADD_OR_CHECKOUT";
      await sendText(phone, addOrCheckoutPrompt(s.cart));
      return;
    }

    // Add more / Checkout
    if (s.stage === "ADD_OR_CHECKOUT") {
      if (text === "1") {
        s.stage = "CATEGORY";
        await sendText(phone, categoriesPrompt(s.restaurant));
      } else if (text === "2") {
        s.stage = "ORDER_TYPE";
        await sendText(phone, orderTypePrompt());
      } else {
        await sendText(phone, "Please send 1 (Add more) or 2 (Checkout).");
      }
      return;
    }

    // Order type
    if (s.stage === "ORDER_TYPE") {
      if (text === "1") { s.orderType = "Delivery";  s.stage = "ADDRESS"; await sendText(phone, "Please share your delivery address."); return; }
      if (text === "2") { s.orderType = "Takeaway"; s.stage = "NAME";    await sendText(phone, "Please share your name for pick-up.");   return; }
      if (text === "3") { s.orderType = "Dine-in";  s.stage = "GUESTS";  await sendText(phone, "How many guests? Send a number.");       return; }
      await sendText(phone, "Please choose 1, 2 or 3.\n\n" + orderTypePrompt());
      return;
    }

    // Collect details
    if (s.stage === "ADDRESS") { s.address = textRaw; s.stage = "CONFIRM"; }
    if (s.stage === "NAME")    { s.customerName = textRaw; s.stage = "CONFIRM"; }
    if (s.stage === "GUESTS")  {
      const g = parseInt(text, 10);
      if (!Number.isInteger(g) || g <= 0) { await sendText(phone, "Please send a valid number of guests."); return; }
      s.guests = g; s.stage = "CONFIRM";
    }

    // Confirm + Save
    if (s.stage === "CONFIRM") {
      await sendText(phone, finalSummary(s));
      await sendText(phone, "Saving your order…");
      const result = await saveCart(s.restaurant, phone, s);
      if (result.ok) {
        await sendText(phone, "✅ Saved to Airtable. Thank you!\nType 'menu' to order again, or 'reset' to start fresh.");
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

// ------------ DIAGNOSTIC (optional) ------------
async function quickWrite({ baseId, tableId, fields }) {
  const url = `https://api.airtable.com/v0/${baseId}/${tableId}`;
  const headers = { Authorization: `Bearer ${AIRTABLE_API_KEY}`, "Content-Type": "application/json" };
  const created = await axios.post(url, { fields }, { headers });
  const id = created?.data?.id;
  if (id) await axios.delete(`${url}/${id}`, { headers });
  return id;
}
app.get("/diag/airtable", async (_req, res) => {
  try {
    const now = new Date().toISOString();
    const rec1 = await quickWrite({
      baseId: AIRTABLE_BASE_ID_MANDI, tableId: AIRTABLE_TABLE_ID_MANDI,
      fields: {
        "Phone Number": "+61400000000", "Order Item": "DIAG — Chicken Mandi",
        "Quantity": 1, "Address": "Diag Street", "Status": "Pending",
        "Order Type": "Delivery", "Order Time": now,
      }
    });
    const rec2 = await quickWrite({
      baseId: AIRTABLE_BASE_ID_FUADIJAN, tableId: AIRTABLE_TABLE_ID_FUADIJAN,
      fields: {
        "CustomerName": "Diag User", "PhoneNumber": "+61400000000",
        "MenuItem": "DIAG — Beef Burger", "Quantity": 1, "Address": "Diag Street",
        "OrderType": "Takeaway", "OrderTime": now,
      }
    });
    res.json({ ok: true, mandiTest: rec1, fuadijanTest: rec2 });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.response?.data || e.message });
  }
});

app.get("/", (_req, res) => res.send("OK"));

// ------------ START ------------
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
