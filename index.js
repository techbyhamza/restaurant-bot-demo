// index.js — EN-only WhatsApp Restaurant Bot with 7-option main menu
// Env needed: ACCESS_TOKEN, PHONE_NUMBER_ID, VERIFY_TOKEN,
//             AIRTABLE_API_KEY, AIRTABLE_BASE_ID, AIRTABLE_TABLE_NAME,
//             RESTAURANT_NAME (e.g., "Crystal Leets")

import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// ---------- ENV ----------
const {
  ACCESS_TOKEN,
  PHONE_NUMBER_ID,
  VERIFY_TOKEN,
  AIRTABLE_API_KEY,
  AIRTABLE_BASE_ID,
  AIRTABLE_TABLE_NAME,
  RESTAURANT_NAME = "My Restaurant",
} = process.env;

const WA_URL = `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`;

// ---------- SIMPLE SESSION STORE ----------
const sessions = new Map();
/*
  session = {
    step: 'menu' | 'ask_type' | 'ask_item' | 'ask_qty' | 'ask_address' | 'ask_payment' | 'confirm',
    orderType: 'Delivery' | 'Takeaway' | 'Dine-in',
    itemCode: string, orderItem: string, quantity: number, address: string,
    paymentMethod: 'Cash'|'Card'
  }
*/

// ---------- DEMO MENU (edit freely) ----------
const MENU = [
  { code: "B1", name: "Beef Burger", price: 8.99 },
  { code: "C1", name: "Chicken Burger", price: 7.99 },
  { code: "P1", name: "Pepperoni Pizza (8\")", price: 11.5 },
  { code: "P2", name: "Veggie Pizza (8\")", price: 10.5 },
  { code: "S1", name: "Greek Salad", price: 6.5 },
  { code: "D1", name: "Chocolate Donut", price: 2.5 },
];

function menuText() {
  const lines = MENU.map(
    (m) => `• ${m.code} — ${m.name} ($${m.price.toFixed(2)})`
  );
  return [
    `Here is our menu 📋`,
    ...lines,
    "",
    "Reply with the **item code** (e.g., B1) to order.",
  ].join("\n");
}

// ---------- WHATSAPP SEND ----------
async function sendText(to, body) {
  try {
    await axios.post(
      WA_URL,
      { messaging_product: "whatsapp", to, type: "text", text: { body } },
      { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
    );
  } catch (e) {
    console.error("sendText error:", e?.response?.data || e.message);
  }
}

// ---------- HELPERS ----------
function getFrom(payload) {
  return (
    payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from ||
    payload?.entry?.[0]?.changes?.[0]?.value?.statuses?.[0]?.recipient_id ||
    ""
  );
}
function getIncomingText(payload) {
  const msg = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg) return "";
  if (msg.type === "text") return msg.text?.body || "";
  if (msg.type === "interactive")
    return (
      msg.interactive?.button_reply?.title ||
      msg.interactive?.list_reply?.title ||
      ""
    );
  return "";
}

function showMainMenu() {
  return [
    `Welcome to *${RESTAURANT_NAME}* 👋`,
    `Please choose an option (1–7):`,
    `1) View Menu`,
    `2) Order — Delivery`,
    `3) Order — Takeaway`,
    `4) Order — Dine‑in`,
    `5) Check Order Status (coming soon)`,
    `6) Talk to a Human (coming soon)`,
    `7) Help / Restart`,
  ].join("\n");
}

function findItemByCode(code) {
  const c = (code || "").trim().toUpperCase();
  return MENU.find((m) => m.code === c) || null;
}

function parseQty(txt) {
  const m = (txt || "").match(/\b(\d+)\b/);
  return m ? Math.max(1, parseInt(m[1], 10)) : null;
}

function orderSummary(s) {
  const itemLine = s.orderItem
    ? `${s.orderItem}${s.quantity ? ` x${s.quantity}` : ""}`
    : "—";
  const parts = [
    "Order Summary ✅",
    `• Type: ${s.orderType}`,
    `• Item: ${itemLine}`,
    s.orderType === "Delivery" ? `• Address: ${s.address || "—"}` : null,
    `• Payment: ${s.paymentMethod || "—"}`,
  ].filter(Boolean);
  return parts.join("\n");
}

// ---------- AIRTABLE ----------
async function saveToAirtable(s, phone) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(
    AIRTABLE_TABLE_NAME
  )}`;
  const fields = {
    "Phone Number": phone,
    "Order Item": s.orderItem || "",
    "Quantity": s.quantity || 1,
    "Address": s.address || "",
    "Status": "Pending",
    "Order Time": new Date().toISOString(),
    "Order Type": s.orderType || "",
    "Payment Method": s.paymentMethod || "",
    "Payment Status": "N/A",
  };
  try {
    const r = await axios.post(
      url,
      { records: [{ fields }] },
      {
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    return !!r?.data;
  } catch (e) {
    console.error("Airtable save error:", e?.response?.data || e.message);
    return false;
  }
}

// ---------- FLOW ----------
async function route(from, text) {
  // bootstrap session
  if (!sessions.has(from)) {
    sessions.set(from, { step: "menu" });
    await sendText(from, showMainMenu());
    return;
  }

  const s = sessions.get(from);
  const msg = (text || "").trim();

  // global restart
  if (/^(7|help|restart|reset)$/i.test(msg)) {
    sessions.set(from, { step: "menu" });
    await sendText(from, "Restarted. 👇\n" + showMainMenu());
    return;
  }

  // -------- main menu --------
  if (s.step === "menu") {
    if (/^1$/.test(msg) || /^view menu$/i.test(msg)) {
      await sendText(from, menuText());
      // stay in menu, allow immediate code entry
      s.step = "ask_item_from_menu";
      return;
    }
    if (/^2$/.test(msg)) {
      s.orderType = "Delivery";
    } else if (/^3$/.test(msg)) {
      s.orderType = "Takeaway";
    } else if (/^4$/.test(msg)) {
      s.orderType = "Dine-in";
    } else if (/^5$|^6$/.test(msg)) {
      await sendText(
        from,
        "This option is coming soon. For now, please choose 1–4 or 7 to restart."
      );
      return;
    } else if (/^[A-Za-z]\d{1,2}$/.test(msg)) {
      // user typed code right after viewing menu
      s.step = "ask_item_from_menu";
    } else {
      await sendText(from, "Please choose 1–7.\n\n" + showMainMenu());
      return;
    }

    if (s.orderType) {
      s.step = "ask_item";
      await sendText(
        from,
        "Great! What would you like to order?\nYou can type an item name, or send an item **code** (e.g., B1)."
      );
      return;
    }
  }

  // typed item code directly after menu view
  if (s.step === "ask_item_from_menu") {
    const item = findItemByCode(msg);
    if (item) {
      s.orderItem = item.name;
      s.itemCode = item.code;
      s.step = "ask_qty";
      await sendText(from, `How many **${item.name}**? (e.g., 1 or 2)`);
      return;
    }
    // if not a code, bounce back to menu
    await sendText(
      from,
      "Please reply with a valid item code from the menu, or type 7 to restart."
    );
    return;
  }

  // ask item in normal flow
  if (s.step === "ask_item") {
    const asCode = findItemByCode(msg);
    if (asCode) {
      s.orderItem = asCode.name;
      s.itemCode = asCode.code;
    } else if (msg.length >= 2) {
      s.orderItem = msg;
    } else {
      await sendText(from, "Please enter a valid item or menu code.");
      return;
    }
    s.step = "ask_qty";
    await sendText(from, `How many **${s.orderItem}**? (e.g., 1 or 2)`);
    return;
  }

  if (s.step === "ask_qty") {
    const q = parseQty(msg);
    if (!q) {
      await sendText(from, "Please send a number for quantity (1, 2, 3…).");
      return;
    }
    s.quantity = q;

    if (s.orderType === "Delivery") {
      s.step = "ask_address";
      await sendText(from, "Please share your delivery address.");
    } else {
      s.address = "";
      s.step = "ask_payment";
      await sendText(from, "Choose payment (dummy): **Cash** or **Card**.");
    }
    return;
  }

  if (s.step === "ask_address") {
    if (msg.length < 4) {
      await sendText(from, "Please enter a complete address.");
      return;
    }
    s.address = msg;
    s.step = "ask_payment";
    await sendText(from, "Choose payment (dummy): **Cash** or **Card**.");
    return;
  }

  if (s.step === "ask_payment") {
    if (!/^(cash|card)$/i.test(msg)) {
      await sendText(from, "Please type **Cash** or **Card**.");
      return;
    }
    s.paymentMethod = /^cash$/i.test(msg) ? "Cash" : "Card";
    s.step = "confirm";
    await sendText(from, orderSummary(s));
    await sendText(
      from,
      'Type **Confirm** to place the order, or **7** to restart.'
    );
    return;
  }

  if (s.step === "confirm") {
    if (/^confirm$/i.test(msg)) {
      const ok = await saveToAirtable(s, from);
      if (ok) {
        await sendText(
          from,
          "Your order was received 🎉 Thank you! We’ll update you soon."
        );
      } else {
        await sendText(
          from,
          "Sorry, we couldn’t save your order right now. Please try again."
        );
      }
      sessions.delete(from);
      // send main menu again for convenience
      await sendText(from, "Anything else?\n" + showMainMenu());
      sessions.set(from, { step: "menu" });
      return;
    }
    await sendText(from, 'Please type **Confirm**, or **7** to restart.');
    return;
  }

  // fallback
  await sendText(from, "I didn’t get that. Type **7** for Help/Restart.");
}

// ---------- ROUTES ----------
app.get("/health", (_, res) => res.status(200).send("OK"));

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const from = getFrom(req.body);
    const text = getIncomingText(req.body);
    if (from && text) {
      await route(from, text);
    }
  } catch (e) {
    console.error("Webhook handler error:", e?.message);
  }
  res.sendStatus(200);
});

// ---------- START ----------
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Bot running on ${PORT}`));
