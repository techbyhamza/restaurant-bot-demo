// index.js  — Hamza's Restaurant Bot (Railway)

// ----- Imports & App -----
const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

// ----- Env -----
const {
  ACCESS_TOKEN,          // WhatsApp Cloud API token
  PHONE_NUMBER_ID,       // WhatsApp phone number id
  VERIFY_TOKEN,          // webhook verify string
  AIRTABLE_API_KEY,      // PAT with read/write + schema
  AIRTABLE_BASE_ID_MANDI,
  AIRTABLE_BASE_ID_FUADIJAN, // same base id as MANDI (one Base, two tables)
  AIRTABLE_TABLE_ID_MANDI,   // Orders_mandi
  AIRTABLE_TABLE_ID_FUADIJAN // Orders_Fuadijan
} = process.env;

// One-time log so you can confirm IDs in Deploy Logs
console.log("Airtable config:", {
  base_mandi: AIRTABLE_BASE_ID_MANDI,
  tbl_mandi: AIRTABLE_TABLE_ID_MANDI,
  base_fuadijan: AIRTABLE_BASE_ID_FUADIJAN,
  tbl_fuadijan: AIRTABLE_TABLE_ID_FUADIJAN,
});

// ----- WhatsApp helpers -----
async function sendText(to, body) {
  const url = `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`;
  await axios.post(
    url,
    { messaging_product: "whatsapp", to, text: { body } },
    { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
  );
}

function boxed(n) {
  // 1..10 to emoji boxes
  const map = ["0️⃣","1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"];
  return map[n] || `${n}.`;
}

// ----- In-memory sessions -----
const sessions = new Map(); // key = phone, value = state

function getSession(phone) {
  if (!sessions.has(phone)) {
    sessions.set(phone, {
      stage: "WELCOME",
      restaurant: null,       // "MANDI" | "FUADIJAN"
      cart: [],               // {item, qty}
      orderType: null,        // "Delivery" | "Take-away" | "Dine-in"
      address: null,
      customerName: null,
      guests: null
    });
  }
  return sessions.get(phone);
}
function resetSession(phone) { sessions.delete(phone); }

// ----- Menus -----
const RESTAURANTS = [
  { key: "MANDI", name: "Mat’am Al Mandi" },
  { key: "FUADIJAN", name: "Fuadijan" }
];

// Mandi simple categories per your request
const MANDI_CATEGORIES = [
  { code: 1, name: "Rice", items: [
      { code: 1, label: "Plain Rice" },
      { code: 2, label: "Mandi Rice" },
    ]},
  { code: 2, name: "Chicken", items: [
      { code: 1, label: "Chicken Mandi" },
      { code: 2, label: "Chicken Kabsa" },
    ]},
];

// Fuadijan short demo menu
const FUADIJAN_CATEGORIES = [
  { code: 1, name: "Burgers & Wraps", items: [
      { code: 1, label: "Zinger Burger" },
      { code: 2, label: "Grilled Wrap" },
    ]},
  { code: 2, name: "Drinks", items: [
      { code: 1, label: "Cola" },
      { code: 2, label: "Mango Lassi" },
    ]},
];

function restaurantName(key){ return RESTAURANTS.find(r=>r.key===key)?.name || key; }
function getCategories(key){ return key==="MANDI" ? MANDI_CATEGORIES : FUADIJAN_CATEGORIES; }

// ----- Airtable helpers -----
async function saveRecordToAirtable_MANDI({ phone, item, qty, orderType, address }) {
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
    // If you kept an Attachment column and it's NOT required, you may add a dummy URL:
    // "Attachment": [{ url: "https://via.placeholder.com/150" }],
  };
  return axios.post(url, { fields }, { headers });
}

async function saveRecordToAirtable_FUADIJAN({ phone, item, qty, orderType, address, customerName }) {
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

async function saveCartToAirtable(restKey, phone, session) {
  const saves = session.cart.map(c => {
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
    return { ok: true };
  } catch (e) {
    const apiErr = e?.response?.data || e.message || "Unknown error";
    console.error("Airtable save error:", apiErr);
    const msg = typeof apiErr === "string"
      ? apiErr
      : apiErr?.error?.message || JSON.stringify(apiErr).slice(0, 400);
    return { ok: false, msg };
  }
}

// ----- Message builders -----
function restaurantsPrompt() {
  return [
    "Please choose a restaurant:",
    `${boxed(1)} Mat’am Al Mandi`,
    `${boxed(2)} Fuadijan`,
    "",
    "Type the number, or 'reset' anytime."
  ].join("\n");
}
function categoriesPrompt(restKey) {
  const cats = getCategories(restKey);
  const lines = cats.map(c => `${boxed(c.code)} ${c.name}`);
  return [
    `You chose: ${restaurantName(restKey)}.`,
    "Pick a category:",
    ...lines
  ].join("\n");
}
function itemsPrompt(restKey, catCode) {
  const cat = getCategories(restKey).find(c => c.code === catCode);
  const lines = cat.items.map(i => `${boxed(i.code)} ${i.label}`);
  return [
    `Category: ${cat.name}`,
    "Select an item:",
    ...lines
  ].join("\n");
}
function qtyPrompt(item) {
  return `How many for "${item}"? (Send a number like 1, 2, 3)`;
}
function addMoreOrCheckoutPrompt(session) {
  const summary = session.cart.map((c, idx) => `${idx+1}) ${c.item} × ${c.qty}`).join("\n");
  return [
    "Added to cart ✅",
    summary ? `\nCart:\n${summary}` : "",
    `\n${boxed(1)} Add more`,
    `${boxed(2)} Checkout`
  ].join("");
}
function orderTypePrompt() {
  return [
    "Choose order type:",
    `${boxed(1)} Delivery`,
    `${boxed(2)} Take-away`,
    `${boxed(3)} Dine-in`
  ].join("\n");
}
function addressPrompt(){ return "Please share your delivery address (text message)."; }
function namePrompt(){ return "Please share your name (for pick-up)."; }
function guestsPrompt(){ return "How many guests? (Send a number)"; }

function finalSummary(session) {
  const lines = session.cart.map((c, idx) => `${idx+1}) ${c.item} × ${c.qty}`).join("\n");
  const extra =
    session.orderType === "Delivery" ? `\n📍 Address: ${session.address}` :
    session.orderType === "Take-away" ? `\n👤 Name: ${session.customerName}` :
    `\n👥 Guests: ${session.guests}`;
  return [
    `${restaurantName(session.restaurant)} — Order Summary`,
    lines,
    `\nOrder Type: ${session.orderType}`,
    extra,
    "\n💳 Payment: Pay on Counter"
  ].join("\n");
}

// ----- Webhook verify (GET) -----
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ----- Webhook receiver (POST) -----
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const msg = change?.value?.messages?.[0];
    const phone = msg?.from;

    res.sendStatus(200); // ack early

    if (!phone || !msg?.text?.body) return;
    const text = msg.text.body.trim().toLowerCase();

    // Reset / Menu shortcuts
    if (text === "reset") { resetSession(phone); await sendText(phone, "Session cleared. Type 'menu' to start again."); return; }
    if (text === "menu" || text === "hi" || text === "hello" || text === "start") {
      resetSession(phone);
      const s = getSession(phone);
      s.stage = "RESTAURANT";
      await sendText(phone, restaurantsPrompt());
      return;
    }

    const s = getSession(phone);

    // Initial welcome
    if (s.stage === "WELCOME") {
      s.stage = "RESTAURANT";
      await sendText(phone, restaurantsPrompt());
      return;
    }

    // Restaurant select
    if (s.stage === "RESTAURANT") {
      if (text === "1" || text === "2") {
        s.restaurant = text === "1" ? "MANDI" : "FUADIJAN";
        s.stage = "CATEGORY";
        await sendText(phone, categoriesPrompt(s.restaurant));
      } else {
        await sendText(phone, "Please send 1 or 2.\n\n" + restaurantsPrompt());
      }
      return;
    }

    // Category choose
    if (s.stage === "CATEGORY") {
      const n = parseInt(text, 10);
      const cats = getCategories(s.restaurant);
      const cat = cats.find(c => c.code === n);
      if (!cat) { await sendText(phone, "Please pick a valid category number.\n\n" + categoriesPrompt(s.restaurant)); return; }
      s.category = cat.code;
      s.stage = "ITEM";
      await sendText(phone, itemsPrompt(s.restaurant, s.category));
      return;
    }

    // Item choose
    if (s.stage === "ITEM") {
      const n = parseInt(text, 10);
      const cat = getCategories(s.restaurant).find(c => c.code === s.category);
      const itm = cat?.items.find(i => i.code === n);
      if (!itm) { await sendText(phone, "Please pick a valid item number.\n\n" + itemsPrompt(s.restaurant, s.category)); return; }
      s.pendingItem = itm.label;
      s.stage = "QTY";
      await sendText(phone, qtyPrompt(itm.label));
      return;
    }

    // Quantity
    if (s.stage === "QTY") {
      const q = parseInt(text, 10);
      if (!Number.isInteger(q) || q <= 0) { await sendText(phone, "Please send a whole number like 1, 2, 3."); return; }
      s.cart.push({ item: s.pendingItem, qty: q });
      s.pendingItem = null;
      s.stage = "ADD_OR_CHECKOUT";
      await sendText(phone, addMoreOrCheckoutPrompt(s));
      return;
    }

    // Add more or checkout
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
      if (text === "1") { s.orderType = "Delivery"; s.stage = "ADDRESS"; await sendText(phone, addressPrompt()); return; }
      if (text === "2") { s.orderType = "Take-away"; s.stage = "NAME"; await sendText(phone, namePrompt()); return; }
      if (text === "3") { s.orderType = "Dine-in"; s.stage = "GUESTS"; await sendText(phone, guestsPrompt()); return; }
      await sendText(phone, "Please choose 1, 2 or 3.\n\n" + orderTypePrompt());
      return;
    }

    // Collect address/name/guests
    if (s.stage === "ADDRESS") { s.address = msg.text.body.trim(); s.stage = "CONFIRM"; }
    if (s.stage === "NAME")    { s.customerName = msg.text.body.trim(); s.stage = "CONFIRM"; }
    if (s.stage === "GUESTS")  {
      const g = parseInt(text, 10);
      if (!Number.isInteger(g) || g <= 0) { await sendText(phone, "Please send a valid number of guests."); return; }
      s.guests = g; s.stage = "CONFIRM";
    }

    // Confirm + save
    if (s.stage === "CONFIRM") {
      await sendText(phone, finalSummary(s));
      await sendText(phone, "Saving your order…");
      const result = await saveCartToAirtable(s.restaurant, phone, s);
      if (result.ok) {
        await sendText(phone, "✅ Saved to Airtable. Thank you!\nType 'menu' to order again, or 'reset' to start fresh.");
      } else {
        await sendText(phone, "⚠️ Error saving to Airtable:\n" + result.msg + "\n\nType 'menu' to try again, or 'reset' to start fresh.");
      }
      resetSession(phone);
      return;
    }

  } catch (e) {
    console.error("Webhook error:", e?.response?.data || e.message);
  }
});

// ----- Diagnostics: create+delete tiny records in both tables -----
async function airtableQuickWrite({ baseId, tableId, fields }) {
  const url = `https://api.airtable.com/v0/${baseId}/${tableId}`;
  const headers = { Authorization: `Bearer ${AIRTABLE_API_KEY}`, "Content-Type": "application/json" };
  const created = await axios.post(url, { fields }, { headers });
  const recId = created?.data?.id;
  if (recId) await axios.delete(`${url}/${recId}`, { headers });
  return recId;
}

app.get("/diag/airtable", async (_req, res) => {
  try {
    const now = new Date().toISOString();
    const rec1 = await airtableQuickWrite({
      baseId: AIRTABLE_BASE_ID_MANDI,
      tableId: AIRTABLE_TABLE_ID_MANDI,
      fields: {
        "Phone Number": "+61400000000",
        "Order Item": "DIAG Chicken Mandi",
        "Quantity": 1,
        "Address": "Diag Street",
        "Status": "Pending",
        "Order Type": "Delivery",
        "Order Time": now,
      },
    });
    const rec2 = await airtableQuickWrite({
      baseId: AIRTABLE_BASE_ID_FUADIJAN,
      tableId: AIRTABLE_TABLE_ID_FUADIJAN,
      fields: {
        "CustomerName": "Diag User",
        "PhoneNumber": "+61400000000",
        "MenuItem": "DIAG Burger",
        "Quantity": 1,
        "Address": "Diag Street",
        "OrderType": "Delivery",
        "OrderTime": now,
      },
    });
    res.json({ ok: true, mandiCreatedThenDeleted: rec1, fuadijanCreatedThenDeleted: rec2 });
  } catch (e) {
    const err = e?.response?.data || e.message || "Unknown error";
    console.error("DIAG error:", err);
    res.status(500).json({ ok: false, error: err });
  }
});

// ----- Health -----
app.get("/", (_req, res) => res.send("OK"));

// ----- Start -----
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
