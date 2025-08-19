// index.js  — WhatsApp Cloud + Express (ESM)
// Requires: express, axios
// ENV VARS needed on Railway: ACCESS_TOKEN, PHONE_NUMBER_ID, VERIFY_TOKEN

import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// ====== Config from ENV ======
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;   // e.g. "740436365822100"
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "my-secret-123";

// ====== Simple in‑memory session (per number) ======
const sessions = new Map();
/*
  session shape:
  {
    step: "idle" | "menu" | "ordering_name" | "ordering_item" | "ordering_qty" | "confirm",
    order: { name?, item?, qty? }
  }
*/

// ====== Helpers ======
const WHATSAPP_API_URL = `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`;

async function sendText(to, body) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body }
  };
  await axios.post(WHATSAPP_API_URL, payload, {
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    }
  });
}

function getSession(phone) {
  if (!sessions.has(phone)) {
    sessions.set(phone, { step: "idle", order: {} });
  }
  return sessions.get(phone);
}

function resetSession(phone) {
  sessions.set(phone, { step: "idle", order: {} });
}

// ====== Menu text ======
const MENU_TEXT =
  "🍽️ *Welcome to Demo Restaurant!*\n" +
  "Reply with a number:\n" +
  "1️⃣  View Menu\n" +
  "2️⃣  Place an Order\n" +
  "3️⃣  Help / Talk to human\n\n" +
  "You can type *menu* anytime.";

const FOOD_MENU =
  "📋 *Today’s Menu*\n" +
  "• Margherita Pizza — $12\n" +
  "• Pepperoni Pizza — $14\n" +
  "• Veggie Burger — $10\n" +
  "• Fries — $4\n\n" +
  "Type *2* to start an order.";

// ====== Webhook: Verify (GET) ======
app.get("/webhook", (req, res) => {
  try {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  } catch {
    return res.sendStatus(500);
  }
});

// ====== Webhook: Receive (POST) ======
app.post("/webhook", async (req, res) => {
  // Must 200 quickly to Meta
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const messages = change?.value?.messages;
    if (!messages || !messages.length) return;

    for (const msg of messages) {
      // Only text for now
      const from = msg.from; // E.164 string
      const type = msg.type;

      // Ignore non-user messages (e.g., statuses)
      if (!from) continue;

      // Handle text
      if (type === "text") {
        const text = (msg.text?.body || "").trim();
        await handleText(from, text);
      } else {
        await sendText(from, "📎 Please send text messages for now. Type *menu* to begin.");
      }
    }
  } catch (e) {
    // Optional: log error
    // console.error("Webhook error:", e?.response?.data || e.message);
  }
});

async function handleText(from, text) {
  const session = getSession(from);
  const t = text.toLowerCase();

  // Global shortcuts
  if (["menu", "start", "hi", "hello", "hey"].some(k => t === k)) {
    session.step = "menu";
    await sendText(from, MENU_TEXT);
    return;
  }
  if (t === "cancel") {
    resetSession(from);
    await sendText(from, "❌ Order cancelled. Type *menu* to start again.");
    return;
  }

  // Flow:
  switch (session.step) {
    case "idle": {
      // First contact
      session.step = "menu";
      await sendText(from, MENU_TEXT);
      break;
    }

    case "menu": {
      if (t === "1" || t.includes("view")) {
        await sendText(from, FOOD_MENU);
      } else if (t === "2" || t.includes("order")) {
        session.step = "ordering_name";
        session.order = {};
        await sendText(from, "👤 Great! What’s your *name*?");
      } else if (t === "3" || t.includes("help")) {
        await sendText(from, "👩‍💼 A human agent will contact you shortly. Type *menu* to go back.");
      } else {
        await sendText(from, "🤔 I didn’t get that.\n" + MENU_TEXT);
      }
      break;
    }

    case "ordering_name": {
      session.order.name = text;
      session.step = "ordering_item";
      await sendText(
        from,
        "🍽️ Thanks, *" +
          session.order.name +
          "*.\nWhat would you like to order?\n(e.g., *Margherita Pizza*, *Veggie Burger*, *Fries*)"
      );
      break;
    }

    case "ordering_item": {
      session.order.item = text;
      session.step = "ordering_qty";
      await sendText(from, `How many *${session.order.item}*? (enter a number)`);
      break;
    }

    case "ordering_qty": {
      const qty = parseInt(text, 10);
      if (!Number.isFinite(qty) || qty <= 0) {
        await sendText(from, "Please enter a valid number for quantity.");
        return;
      }
      session.order.qty = qty;
      session.step = "confirm";
      await sendText(
        from,
        "✅ Please confirm your order:\n" +
          `• Name: *${session.order.name}*\n` +
          `• Item: *${session.order.item}*\n` +
          `• Qty: *${session.order.qty}*\n\n` +
          "Reply *yes* to confirm or *cancel* to discard."
      );
      break;
    }

    case "confirm": {
      if (t === "yes" || t === "y") {
        // Here you can save to Airtable/Sheets
        await sendText(
          from,
          "🎉 Your order has been placed! We’ll get started right away.\nType *menu* for anything else."
        );
        resetSession(from);
      } else {
        await sendText(from, "Okay. Type *menu* to start again or *cancel* to exit.");
      }
      break;
    }

    default: {
      session.step = "idle";
      await sendText(from, "Type *menu* to start.");
    }
  }
}

// Health check
app.get("/", (_req, res) => res.send("OK"));
app.get("/health", (_req, res) => res.json({ ok: true }));

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
