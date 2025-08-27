// WhatsApp Restaurant Bot (Express + Cloud API) — Multi-restaurant + Categories + OrderType
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

// Restaurants definition
const RESTAURANTS = {
  mandi: {
    title: "Mat'am Al Mandi",
    currency: "AUD",
    items: [
      { code: 1, name: "Lamb Mandi", price: 20, emoji: "🍖" },
      { code: 2, name: "Chicken Mandi", price: 16, emoji: "🍗" },
      { code: 3, name: "Family Platter", price: 55, emoji: "🍽️" },
    ],
  },

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
          { code: 2, name: "Juices (Eastcoast)", price: 5.0, emoji: "🧃" },
          { code: 3, name: "Milk Shake (Mango)", price: 9.0, emoji: "🥤" },
          { code: 4, name: "Bert’s 1.25 Ltr Bottle", price: 6.0, emoji: "🧪" },
          { code: 5, name: "Spring Water / Pakola", price: 3.0, emoji: "💧" },
        ],
      },
      {
        id: "breakfast",
        label: "Breakfast",
        emoji: "🍳",
        items: [
          { code: 1, name: "Halwa Poori (2)", price: 14.99, emoji: "🥘" },
          { code: 2, name: "Anda Paratha (2 + Omelette)", price: 11.99, emoji: "🍳" },
          { code: 3, name: "Anda Bun", price: 8.99, emoji: "🥯" },
          { code: 4, name: "Beef Nihari (Bowl)", price: 14.99, emoji: "🍲" },
          { code: 5, name: "Karak Chai", price: 4.0, emoji: "☕" },
          { code: 6, name: "Doodh Patti (add-on)", price: 2.5, emoji: "🥛" },
        ],
      },
      {
        id: "karahi",
        label: "Karahi & Nihari",
        emoji: "🍲",
        items: [
          { code: 1, name: "Chicken Karahi (Half)", price: 24.0, emoji: "🍗" },
          { code: 2, name: "Salt & Pepper Lamb Karahi (500g)", price: 30.0, emoji: "🍖" },
          { code: 3, name: "Beef Nihari Plate", price: 15.0, emoji: "🥘" },
        ],
      },
      {
        id: "burgers",
        label: "Burgers & Wraps",
        emoji: "🍔",
        items: [
          { code: 1, name: "Beef Burger", price: 14.0, emoji: "🍔" },
          { code: 2, name: "Chicken Shami Burger", price: 11.0, emoji: "🍔" },
          { code: 3, name: "Chicken Tikka Burger", price: 13.0, emoji: "🍔" },
          { code: 4, name: "Wrap (Chicken Tikka/Beef Seekh)", price: 13.0, emoji: "🌯" },
          { code: 5, name: "Veggie Wrap", price: 13.0, emoji: "🌯" },
          { code: 6, name: "Dahi Papri Chana Chaat", price: 9.5, emoji: "🥗" },
        ],
      },
      {
        id: "snacks",
        label: "Snack Packs & Chips",
        emoji: "🍟",
        items: [
          { code: 1, name: "Chips (Small)", price: 5.0, emoji: "🍟" },
          { code: 2, name: "Chips (Large)", price: 10.0, emoji: "🍟" },
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
          { code: 5, name: "Lamb Chops – 3 Pieces", price: 20.0, emoji: "🥩" },
          { code: 6, name: "Beef Seekh – 2 Skewers", price: 18.0, emoji: "🥓" },
          { code: 7, name: "Beef Chapli Kebab – 1 Kebab", price: 18.0, emoji: "🥘" },
        ],
      },
      {
        id: "addons",
        label: "Add-ons & Breads",
        emoji: "🥗",
        items: [
          { code: 1, name: "Garden Salad", price: 2.0, emoji: "🥗" },
          { code: 2, name: "Yogurt Sauce", price: 0.5, emoji: "🥣" },
          { code: 3, name: "Drinks (from)", price: 3.0, emoji: "🥤" },
          { code: 4, name: "Tandoori Roti", price: 2.0, emoji: "🫓" },
          { code: 5, name: "Naan / Souvlaki Bread", price: 2.5, emoji: "🫓" },
          { code: 6, name: "Rice (300g)", price: 3.0, emoji: "🍚" },
        ],
      },
      {
        id: "sweets",
        label: "Sweets",
        emoji: "🍮",
        items: [
          { code: 1, name: "Gulab Jamun (1 pc)", price: 2.0, emoji: "🍮" },
          { code: 2, name: "Kheer (200g)", price: 6.0, emoji: "🍚" },
        ],
      },
    ],
  },
};

// Order of restaurants at selection page
const RESTAURANT_ORDER = ["mandi", "fuadijan"];

/* ============================ SESSIONS ============================ */
// wa_id -> { step, restaurantKey, categoryIdx, itemIdx, qty, orderType, customerName, address }
const SESS = new Map();
function getS(wa) {
  if (!SESS.has(wa)) {
    SESS.set(wa, {
      step: "rest",
      restaurantKey: null,
      categoryIdx: null,
      itemIdx: null,
      qty: null,
      orderType: null,
      customerName: "",
      address: "",
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
    orderType: null,
    customerName: "",
    address: "",
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

function mandiMenuText() {
  const r = RESTAURANTS.mandi;
  let t = `📋 ${r.title} Menu\n\n`;
  r.items.forEach(it => {
    t += `${it.code}️⃣ ${it.emoji} ${it.name} — ${curf(it.price, r.currency)}\n`;
  });
  t += `\n👉 Reply with item number`;
  return t;
}

function fuadijanCategoryText() {
  const r = RESTAURANTS.fuadijan;
  let t = `📋 ${r.title} — Choose a category:\n\n`;
  r.categories.forEach((c, i) => {
    t += `${i + 1}️⃣ ${c.emoji} ${c.label}\n`;
  });
  t += `\n👉 Reply with a number`;
  return t;
}

function fuadijanItemsText(catIdx) {
  const r = RESTAURANTS.fuadijan;
  const cat = r.categories[catIdx];
  let t = `${cat.emoji} ${r.title} — ${cat.label}\n\n`;
  cat.items.forEach(it => {
    t += `${it.code}️⃣ ${it.emoji} ${it.name} — ${curf(it.price, r.currency)}\n`;
  });
  t += `\n👉 Reply with item number\n↩️ Type 0 to go Back`;
  return t;
}

function orderTypeText() {
  return (
    "🚚 Choose order type:\n\n" +
    "1️⃣ Delivery\n" +
    "2️⃣ Take-away\n" +
    "3️⃣ Dine-in\n\n" +
    "👉 Reply with 1, 2, or 3"
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

  // Global commands
  if (isHello(text) || text.toLowerCase() === "restart") {
    resetS(wa);
    return sendText(wa, restaurantSelectionText());
  }
  if (text.toLowerCase() === "menu" && s.restaurantKey === "mandi") {
    return sendText(wa, mandiMenuText());
  }
  if (text.toLowerCase() === "menu" && s.restaurantKey === "fuadijan" && s.step !== "fu_items") {
    s.step = "fu_cat";
    return sendText(wa, fuadijanCategoryText());
  }

  /* Step: choose restaurant */
  if (s.step === "rest") {
    if (/^\d$/.test(text)) {
      const n = parseInt(text, 10);
      if (n >= 1 && n <= RESTAURANT_ORDER.length) {
        const key = RESTAURANT_ORDER[n - 1];
        s.restaurantKey = key;
        if (key === "mandi") {
          s.step = "mandi_items";
          return sendText(wa, mandiMenuText());
        } else {
          s.step = "fu_cat";
          return sendText(wa, fuadijanCategoryText());
        }
      }
    }
    return sendText(wa, restaurantSelectionText());
  }

  /* Mat'am Al Mandi: items -> order type -> qty -> confirm */
  if (s.restaurantKey === "mandi") {
    if (s.step === "mandi_items") {
      const n = parseInt(text, 10);
      const list = RESTAURANTS.mandi.items;
      const item = list.find(it => it.code === n);
      if (!item) return sendText(wa, "Please send a valid item number (1–3) or type menu.");
      s.itemIdx = list.indexOf(item);
      s.step = "otype";               // NEW
      return sendText(wa, orderTypeText());
    }
  }

  /* Fuadijan: category -> items -> order type -> qty -> confirm */
  if (s.restaurantKey === "fuadijan") {
    if (s.step === "fu_cat") {
      if (/^\d$/.test(text)) {
        const idx = parseInt(text, 10) - 1;
        const cats = RESTAURANTS.fuadijan.categories;
        if (idx >= 0 && idx < cats.length) {
          s.categoryIdx = idx;
          s.step = "fu_items";
          return sendText(wa, fuadijanItemsText(idx));
        }
      }
      return sendText(wa, fuadijanCategoryText());
    }

    if (s.step === "fu_items") {
      if (text === "0") {
        s.categoryIdx = null;
        s.step = "fu_cat";
        return sendText(wa, fuadijanCategoryText());
      }
      const n = parseInt(text, 10);
      const cat = RESTAURANTS.fuadijan.categories[s.categoryIdx];
      const item = cat.items.find(it => it.code === n);
      if (!item) return sendText(wa, "Please send a valid item number or 0 to go back.");
      s.itemIdx = cat.items.indexOf(item);
      s.step = "otype";               // NEW
      return sendText(wa, orderTypeText());
    }
  }

  /* Step: order type (Delivery / Take-away / Dine-in) */
  if (s.step === "otype" && s.itemIdx != null) {
    if (/^[123]$/.test(text)) {
      const map = { 1: "Delivery", 2: "Take-away", 3: "Dine-in" };
      s.orderType = map[parseInt(text, 10)];
      s.step = "qty";
      return sendText(wa, "Please send *quantity* (1–99).");
    }
    return sendText(wa, orderTypeText());
  }

  /* Step: quantity */
  if (s.step === "qty" && s.itemIdx != null) {
    if (/^\d{1,2}$/.test(text)) {
      const q = parseInt(text, 10);
      if (q >= 1 && q <= 99) {
        s.qty = q;
        s.step = "confirm";
        const { item, r, catLabel } = getSelectedItemDetails(s);
        const total = (item.price * q).toFixed(2);
        return sendText(
          wa,
          `🧾 Order Summary\n` +
            `Restaurant: ${r.title}${catLabel ? `\nCategory: ${catLabel}` : ""}\n` +
            `Item: ${item.emoji} ${item.name}\n` +
            `Order Type: ${s.orderType}\n` +
            `Qty: ${q}\n` +
            `Total: ${curf(total, r.currency)}\n\n` +
            `✅ Confirm → type *yes*\n❌ Cancel → type *no*`
        );
      }
    }
    return sendText(wa, "✖️ Please send a valid quantity (1–99).");
  }

  /* Step: confirm */
  if (s.step === "confirm" && s.itemIdx != null && s.qty) {
    const ans = text.toLowerCase();
    if (ans === "yes") {
      const { item, r } = getSelectedItemDetails(s);
      const total = (item.price * s.qty).toFixed(2);

      // TODO: Save to Airtable/DB using field names below
      const record = {
        [DB_FIELDS.CustomerName]: s.customerName || "",
        [DB_FIELDS.PhoneNumber]: wa,
        [DB_FIELDS.MenuItem]: `${r.title} - ${item.name}`,
        [DB_FIELDS.Quantity]: s.qty,
        [DB_FIELDS.Address]: s.address || "",
        [DB_FIELDS.OrderType]: s.orderType || "",
        [DB_FIELDS.OrderTime]: new Date().toISOString(),
      };
      // console.log("Would save:", record);

      await sendText(
        wa,
        `🎉 Order confirmed!\n${item.emoji} ${item.name} x ${s.qty}\n` +
          `Order Type: ${s.orderType}\nTotal: ${curf(total, r.currency)}\n\n` +
          `Type *menu* to order again or *restart* to switch restaurant.`
      );
      return resetS(wa);
    }
    if (ans === "no") {
      resetS(wa);
      return sendText(wa, "❌ Order cancelled.\nType *restart* to start again.");
    }
    return sendText(wa, "Please reply *yes* to confirm or *no* to cancel.");
  }

  // fallback
  return sendText(wa, "Type *restart* to start over.");
}

function getSelectedItemDetails(s) {
  const key = s.restaurantKey;
  const r = RESTAURANTS[key];
  if (key === "mandi") {
    const item = r.items[s.itemIdx];
    return { item, r, catLabel: null };
  } else {
    const cat = r.categories[s.categoryIdx];
    const item = cat.items[s.itemIdx];
    return { item, r, catLabel: cat.label };
  }
}

/* ============================== Start ============================ */
app.listen(PORT, () => console.log(`✅ Bot running on port ${PORT}`));
