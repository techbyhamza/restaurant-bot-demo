// index.js — EN WhatsApp bot (numbers-based menu, 2 payment options)
// ENV needed: ACCESS_TOKEN, PHONE_NUMBER_ID, VERIFY_TOKEN,
//             AIRTABLE_API_KEY, AIRTABLE_BASE_ID, AIRTABLE_TABLE_NAME,
//             RESTAURANT_NAME (default: Al Noor Peda)

import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

const {
  ACCESS_TOKEN,
  PHONE_NUMBER_ID,
  VERIFY_TOKEN,
  AIRTABLE_API_KEY,
  AIRTABLE_BASE_ID,
  AIRTABLE_TABLE_NAME,
  RESTAURANT_NAME = "Al Noor Peda",
} = process.env;

const WA_URL = `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`;

// -------- session store --------
const sessions = new Map();
/*
  step: 'menu'|'ask_type'|'ask_item'|'ask_qty'|'ask_address'|'ask_payment'|'confirm'
*/
const MENU = [
  { code: "P1", name: "Margherita Pizza (8\")", price: 9.5 },
  { code: "P2", name: "Pepperoni Pizza (8\")", price: 11.5 },
  { code: "C1", name: "Chicken Burger", price: 7.99 },
  { code: "B1", name: "Beef Burger", price: 8.99 },
  { code: "S1", name: "Chicken Shawarma", price: 6.5 },
  { code: "B2", name: "Chicken Biryani", price: 8.0 },
  { code: "D1", name: "Gulab Jamun (2 pcs)", price: 3.0 },
];

function menuTextNumbered() {
  const lines = MENU.map(
    (m, i) => `${i + 1}) ${m.name} — $${m.price.toFixed(2)}  [${m.code}]`
  );
  return [
    "Here is our menu 📋",
    ...lines,
    "",
    "Reply with the **number** (e.g., 1) or **code** (e.g., P1).",
  ].join("\n");
}

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

function findItemByNumberOrCode(txt) {
  const t = (txt || "").trim().toUpperCase();
  const n = parseInt(t, 10);
  if (!isNaN(n) && n >= 1 && n <= MENU.length) return MENU[n - 1];
  return MENU.find((m) => m.code === t) || null;
}

function parseQty(txt) {
  const m = (txt || "").match(/\b(\d+)\b/);
  return m ? Math.max(1, parseInt(m[1], 10)) : null;
}

function orderSummary(s) {
  const lines = [
    "Order Summary ✅",
    `• Type: ${s.orderType}`,
    `• Item: ${s.orderItem}${s.quantity ? ` x${s.quantity}` : ""}`,
  ];
  if (s.orderType === "Delivery") lines.push(`• Address: ${s.address || "—"}`);
  lines.push(`• Payment: ${s.paymentMethod || "—"}`);
  return lines.join("\n");
}

// ---------- Airtable save with fallback ----------
async function saveToAirtable(s, phone) {
  const baseUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(
    AIRTABLE_TABLE_NAME
  )}`;
  const full = {
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
  const minimal = {
    "Phone Number": phone,
    "Quantity": s.quantity || 1,
    "Address": s.address || "",
    "Status": "Pending",
    "Order Time": new Date().toISOString(),
    "Order Type": s.orderType || "",
  };
  try {
    await axios.post(
      baseUrl,
      { records: [{ fields: full }] },
      {
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    return true;
  } catch (e1) {
    console.error("Airtable full save error:", e1?.response?.data || e1.message);
    try {
      await axios.post(
        baseUrl,
        { records: [{ fields: minimal }] },
        {
          headers: {
            Authorization: `Bearer ${AIRTABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );
      return true;
    } catch (e2) {
      console.error(
        "Airtable minimal save error:",
        e2?.response?.data || e2.message
      );
      return false;
    }
  }
}

// ---------- flow ----------
async function route(from, text) {
  if (!sessions.has(from)) {
    sessions.set(from, { step: "menu" });
    await sendText(from, showMainMenu());
    return;
  }
  const s = sessions.get(from);
  const msg = (text || "").trim();

  if (/^(7|help|restart|reset)$/i.test(msg)) {
    sessions.set(from, { step: "menu" });
    await sendText(from, "Restarted. 👇\n" + showMainMenu());
    return;
  }

  if (s.step === "menu") {
    if (/^1$/.test(msg)) {
      s.step = "ask_item_from_menu";
      await sendText(from, menuTextNumbered());
      return;
    }
    if (/^2$/.test(msg)) s.orderType = "Delivery";
    else if (/^3$/.test(msg)) s.orderType = "Takeaway";
    else if (/^4$/.test(msg)) s.orderType = "Dine-in";
    else if (/^[1-9]\d*$|^[A-Za-z]\d{1,2}$/i.test(msg)) {
      s.step = "ask_item_from_menu";
    } else if (/^[56]$/.test(msg)) {
      await sendText(
        from,
        "This option is coming soon. Please choose 1–4 or 7 to restart."
      );
      return;
    } else {
      await sendText(from, "Please choose 1–7.\n\n" + showMainMenu());
      return;
    }

    if (s.orderType) {
      s.step = "ask_item";
      await sendText(
        from,
        "Great! Reply with menu **number** (e.g., 1) or **code** (e.g., P1) to choose an item."
      );
      return;
    }
  }

  if (s.step === "ask_item_from_menu" || s.step === "ask_item") {
    const item = findItemByNumberOrCode(msg);
    if (!item) {
      await sendText(
        from,
        s.step === "ask_item_from_menu"
          ? "Please reply with a valid menu **number** or **code**."
          : "Please send a valid menu **number** or **code** (e.g., 1 or P1)."
      );
      return;
    }
    s.orderItem = item.name;
    s.itemCode = item.code;
    s.step = "ask_qty";
    await sendText(from, `How many **${item.name}**? (e.g., 1 or 2)`);
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
      await sendText(
        from,
        "Choose payment (dummy): **Pay at Counter** or **Card**."
      );
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
    await sendText(
      from,
      "Choose payment (dummy): **Pay at Counter** or **Card**."
    );
    return;
  }

  if (s.step === "ask_payment") {
    if (!/^(pay at counter|card)$/i.test(msg)) {
      await sendText(from, "Please type **Pay at Counter** or **Card**.");
      return;
    }
    s.paymentMethod = /^card$/i.test(msg) ? "Card" : "Pay at Counter";
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
        await sendText(from, "Your order has been confirmed ✅");
      } else {
        await sendText(
          from,
          "Sorry, we couldn’t save your order right now. Please try again."
        );
      }
      sessions.delete(from);
      await sendText(from, "Anything else?\n" + showMainMenu());
      sessions.set(from, { step: "menu" });
      return;
    }
    await sendText(from, 'Please type **Confirm**, or **7** to restart.');
    return;
  }

  await sendText(from, "I didn’t get that. Type **7** for Help/Restart.");
}

// ---------- routes ----------
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
    if (from && text) await route(from, text);
  } catch (e) {
    console.error("Webhook error:", e?.message);
  }
  res.sendStatus(200);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Bot running on ${PORT}`));
