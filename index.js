// index.js — WhatsApp Restaurant Bot (EN only, no real payments)
// Env: ACCESS_TOKEN, PHONE_NUMBER_ID, VERIFY_TOKEN,
//      AIRTABLE_API_KEY, AIRTABLE_BASE_ID, AIRTABLE_TABLE_NAME

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
} = process.env;

// In‑memory sessions (swap with Redis/DB in prod)
const sessions = new Map();
// session: { step, orderType, orderItem, quantity, address, paymentMethod }

const WA_URL = `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`;

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

function fromNumber(payload) {
  try {
    return (
      payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from ||
      payload?.entry?.[0]?.changes?.[0]?.value?.statuses?.[0]?.recipient_id ||
      ""
    );
  } catch {
    return "";
  }
}

function incomingText(payload) {
  try {
    const msg = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return "";
    if (msg.type === "text") return msg.text.body || "";
    if (msg.type === "interactive") {
      return (
        msg.interactive?.button_reply?.title ||
        msg.interactive?.list_reply?.title ||
        ""
      );
    }
    return "";
  } catch {
    return "";
  }
}

function detectOrderType(text) {
  const t = (text || "").toLowerCase();
  if (/delivery/.test(t)) return "Delivery";
  if (/take\s*away|takeaway|pickup/.test(t)) return "Takeaway";
  if (/dine\s*-?\s*in/.test(t)) return "Dine-in";
  return null;
}

function parseQuantity(text) {
  const m = (text || "").match(/\b(\d+)\b/);
  return m ? Math.max(1, parseInt(m[1], 10)) : null;
}

async function saveToAirtable(order) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(
    AIRTABLE_TABLE_NAME
  )}`;

  const fields = {
    "Phone Number": order.phone,
    "Order Item": order.item || "",
    "Quantity": order.quantity || 1,
    "Address": order.address || "",
    "Status": "Pending",
    "Order Time": new Date().toISOString(),
    "Order Type": order.orderType || "",
    "Payment Method": order.paymentMethod || "", // optional column
    "Payment Status": "N/A", // dummy, always N/A
  };

  try {
    await axios.post(
      url,
      { records: [{ fields }] },
      {
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    return true;
  } catch (e) {
    console.error("Airtable error:", e?.response?.data || e.message);
    return false;
  }
}

function summary(s) {
  return [
    "Order Summary ✅",
    `• Type: ${s.orderType}`,
    `• Item: ${s.orderItem}`,
    `• Qty: ${s.quantity}`,
    s.orderType === "Delivery" ? `• Address: ${s.address}` : null,
    `• Payment: ${s.paymentMethod || "—"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function handle(from, text) {
  if (!sessions.has(from)) {
    sessions.set(from, { step: "ask_type" });
    await sendText(
      from,
      "Welcome! 👋\nIs your order **Delivery**, **Takeaway**, or **Dine‑in**?"
    );
    return;
  }

  const s = sessions.get(from);

  // quick reset
  if (/^(reset|restart)$/i.test(text)) {
    sessions.set(from, { step: "ask_type" });
    await sendText(
      from,
      "Starting over. Is it **Delivery**, **Takeaway**, or **Dine‑in**?"
    );
    return;
  }

  if (s.step === "ask_type") {
    const ot = detectOrderType(text);
    if (!ot) {
      await sendText(
        from,
        "Please type one: **Delivery**, **Takeaway**, or **Dine‑in**."
      );
      return;
    }
    s.orderType = ot;
    s.step = "ask_item";
    await sendText(from, "What would you like to order? (e.g., “Chicken Burger”)");
    return;
  }

  if (s.step === "ask_item") {
    if (!text?.trim()) {
      await sendText(from, "Please enter the item name.");
      return;
    }
    s.orderItem = text.trim();
    s.step = "ask_qty";
    await sendText(from, "How many? (e.g., 1 or 2)");
    return;
  }

  if (s.step === "ask_qty") {
    const q = parseQuantity(text);
    if (!q) {
      await sendText(from, "Please provide a number for quantity (1, 2, 3…).");
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
        "Choose a payment option (dummy): **Cash** or **Card**."
      );
    }
    return;
  }

  if (s.step === "ask_address") {
    if (!text?.trim() || text.trim().length < 4) {
      await sendText(from, "Please enter a complete address.");
      return;
    }
    s.address = text.trim();
    s.step = "ask_payment";
    await sendText(
      from,
      "Choose a payment option (dummy): **Cash** or **Card**."
    );
    return;
  }

  if (s.step === "ask_payment") {
    const t = (text || "").toLowerCase();
    if (!/(cash|card)/.test(t)) {
      await sendText(from, "Please type **Cash** or **Card**.");
      return;
    }
    s.paymentMethod = /cash/.test(t) ? "Cash" : "Card";
    s.step = "confirm";
    await sendText(from, summary(s));
    await sendText(
      from,
      'Type **Confirm** to place the order or **Edit** to start over.'
    );
    return;
  }

  if (s.step === "confirm") {
    if (/^confirm$/i.test(text)) {
      const ok = await saveToAirtable({
        phone: from,
        item: s.orderItem,
        quantity: s.quantity,
        address: s.address,
        orderType: s.orderType,
        paymentMethod: s.paymentMethod,
      });
      if (ok) {
        await sendText(
          from,
          "Your order was received 🎉 We’ll update you soon. Thanks!"
        );
      } else {
        await sendText(
          from,
          "Sorry, we couldn’t save your order right now. Please try again."
        );
      }
      sessions.delete(from);
      return;
    }
    if (/^edit$/i.test(text)) {
      sessions.set(from, { step: "ask_type" });
      await sendText(
        from,
        "Okay, let’s start again. **Delivery**, **Takeaway**, or **Dine‑in**?"
      );
      return;
    }
    await sendText(from, 'Please type **Confirm** or **Edit**.');
    return;
  }

  await sendText(from, 'I didn’t get that. Type **reset** to restart.');
}

// --------- Webhooks ----------
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
    const from = fromNumber(req.body);
    const text = incomingText(req.body);
    if (from && text) await handle(from, text);
  } catch (e) {
    console.error("webhook error:", e.message);
  }
  res.sendStatus(200);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Bot running on ${PORT}`));
