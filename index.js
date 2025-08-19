// index.js
// type: module  (package.json میں "type": "module" ہونا چاہیے)

import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// --- ENV ---
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;

// --- Simple in-memory session store ---
const sessions = new Map(); // key = phone, value = state object

function getSession(phone) {
  if (!sessions.has(phone)) {
    sessions.set(phone, {
      step: "WELCOME",
      item: null,
      qty: null,
      orderType: null, // Delivery | Takeaway | Dine-in
      address: null,
      payment: null, // dummy only (not stored)
    });
  }
  return sessions.get(phone);
}

function resetSession(phone) {
  sessions.delete(phone);
}

// --- Menu (feel free to edit names/prices) ---
const MENU = [
  { code: "1", name: 'Pepperoni Pizza (8")' },
  { code: "2", name: 'Margherita Pizza (12")' },
  { code: "3", name: "Veggie Burger" },
];

const menuText = () => {
  const lines = MENU.map(m => `${m.code}. ${m.name}`).join("\n");
  return (
`Welcome to *Crystal Eats* 👋

Please choose an item by number:
${lines}

Type the number (e.g., 1). 
You can type *7* anytime to restart.`
  );
};

// --- WhatsApp send utility ---
async function sendText(to, text) {
  const url = `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  };
  await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
  });
}

// --- Airtable save (WITHOUT Payment field) ---
async function saveToAirtable({ phone, itemName, qty, address, orderType }) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(
    AIRTABLE_TABLE_NAME
  )}`;
  const fields = {
    "Phone Number": phone,
    "Order Item": itemName,
    "Quantity": Number(qty),
    "Address": address || "",
    "Status": "Pending",
    "Order Type": orderType, // Delivery | Takeaway | Dine-in
    "Order Time": new Date().toISOString(),
  };
  await axios.post(
    url,
    { records: [{ fields }] },
    { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } }
  );
}

// --- Flow helpers ---
function summaryText(s) {
  return (
`Order Summary ✅

• Type: ${s.orderType}
• Item: ${s.item} x${s.qty}
• Payment: ${s.payment}

Type *Confirm* to place the order,
or *7* to restart.`
  );
}

async function handleIncomingText(phone, text) {
  const msg = (text || "").trim();
  const lower = msg.toLowerCase();

  // restart shortcuts
  if (["7", "restart", "menu"].includes(lower)) {
    resetSession(phone);
    await sendText(phone, menuText());
    return;
  }

  // greetings → welcome
  if (["hi", "hello", "hey", "hy"].includes(lower)) {
    resetSession(phone);
    await sendText(phone, menuText());
    return;
  }

  const s = getSession(phone);

  switch (s.step) {
    case "WELCOME": {
      // expect a menu number
      const found = MENU.find(m => m.code === msg);
      if (!found) {
        await sendText(phone, `Sorry, I didn’t get that.\n\n${menuText()}`);
        return;
      }
      s.item = found.name;
      s.step = "ASK_QTY";
      await sendText(
        phone,
        `How many *${found.name}*? (e.g., 1 or 2)`
      );
      return;
    }

    case "ASK_QTY": {
      const n = Number(msg);
      if (!Number.isInteger(n) || n <= 0) {
        await sendText(phone, `Please enter a valid quantity (e.g., 1 or 2).`);
        return;
      }
      s.qty = n;
      s.step = "ASK_ORDER_TYPE";
      await sendText(
        phone,
        `Choose order type:\n• *Delivery*\n• *Takeaway*\n• *Dine-in*\n\n(Type exactly one of the options.)`
      );
      return;
    }

    case "ASK_ORDER_TYPE": {
      const choice =
        ["delivery", "takeaway", "dine-in", "dine in"].find(opt => lower === opt);
      if (!choice) {
        await sendText(
          phone,
          `Please type one option:\n*Delivery*, *Takeaway*, or *Dine-in*.`
        );
        return;
      }
      s.orderType =
        lower === "dine in" ? "Dine-in" : lower.charAt(0).toUpperCase() + lower.slice(1);

      if (s.orderType === "Delivery") {
        s.step = "ASK_ADDRESS";
        await sendText(
          phone,
          `Please share your *delivery address* (street, city).`
        );
      } else {
        s.address = ""; // not required
        s.step = "ASK_PAYMENT";
        await sendText(
          phone,
          `Choose payment (dummy): *Pay at Counter* or *Card*.`
        );
      }
      return;
    }

    case "ASK_ADDRESS": {
      if (msg.length < 3) {
        await sendText(phone, `Please enter a valid address.`);
        return;
      }
      s.address = msg;
      s.step = "ASK_PAYMENT";
      await sendText(
        phone,
        `Choose payment (dummy): *Pay at Counter* or *Card*.`
      );
      return;
    }

    case "ASK_PAYMENT": {
      const valid = ["pay at counter", "card"];
      const pick = valid.find(v => lower === v);
      if (!pick) {
        await sendText(
          phone,
          `Please type one option: *Pay at Counter* or *Card*.`
        );
        return;
      }
      s.payment = pick === "card" ? "Card" : "Pay at Counter";
      s.step = "CONFIRM";
      await sendText(phone, summaryText(s));
      return;
    }

    case "CONFIRM": {
      if (lower === "confirm") {
        try {
          // Save without Payment field
          await saveToAirtable({
            phone,
            itemName: s.item,
            qty: s.qty,
            address: s.address,
            orderType: s.orderType,
          });
          await sendText(
            phone,
            `🎉 *Order placed!* Thank you.\nWe’ll start preparing your order now.\n\nType *menu* to start a new order.`
          );
          resetSession(phone);
        } catch (err) {
          console.error("Airtable save error:", err?.response?.data || err.message);
          await sendText(
            phone,
            `Sorry, we couldn’t save your order right now. Please try again.`
          );
        }
      } else {
        await sendText(
          phone,
          `Please type *Confirm* to place the order, or *7* to restart.`
        );
      }
      return;
    }

    default: {
      resetSession(phone);
      await sendText(phone, menuText());
    }
  }
}

// --- Webhook verify (GET) ---
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// --- Webhook receiver (POST) ---
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    // WhatsApp message structure
    const entry = body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (messages && messages[0]) {
      const msg = messages[0];
      const from = msg.from; // E.164 without +
      const text = msg.text?.body ?? "";

      // Normalize to +E.164
      const phone = from.startsWith("+") ? from : `+${from}`;

      await handleIncomingText(phone, text);
    }

    res.sendStatus(200);
  } catch (e) {
    console.error("Webhook error:", e);
    res.sendStatus(200); // Always 200 to avoid retries storm
  }
});

// --- Health ---
app.get("/health", (_req, res) => res.status(200).send("OK"));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
