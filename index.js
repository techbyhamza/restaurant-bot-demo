// index.js  (Node 18+, package.json has: "type": "module")
import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// ----- Env -----
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;           // Meta permanent token
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;     // WABA phone number id
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;           // webhook verify token

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;

// ----- Simple in-memory sessions -----
const sessions = {}; // key = user phone (E.164), value = state

// ----- Menu (Edit as you like) -----
const MENU = [
  { code: "1", name: 'Margherita Pizza (12")' },
  { code: "2", name: 'Pepperoni Pizza (8")' },
  { code: "3", name: 'Veggie Pizza (12")' },
];

const ORDER_TYPES = ["Delivery", "Takeaway", "Dine-in"];

// ----- Utils -----
function menuText() {
  const lines = MENU.map(i => `*${i.code}*. ${i.name}`);
  return [
    "🍕 *Menu*",
    ...lines,
    "",
    "Reply with the *number* of the item (e.g., 1).",
  ].join("\n");
}

async function sendMessage(to, text) {
  const url = `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  };
  await axios.post(url, body, {
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
  });
}

async function saveToAirtable(record) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(
    AIRTABLE_TABLE_NAME
  )}`;
  const fields = {
    "Phone Number": record.phone,
    "Order Item": record.itemName,
    "Quantity": Number(record.qty) || 1,
    "Address": record.address || "",
    "Status": "Pending",
    "Order Time": new Date().toISOString(),
    "Order Type": record.orderType, // should be one of Delivery/Takeaway/Dine-in
  };
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
}

function startSessionIfNeeded(from) {
  if (!sessions[from]) {
    sessions[from] = {
      step: "menu", // menu -> qty -> orderType -> address? -> summary
      item: null,
      qty: null,
      orderType: null,
      address: null,
    };
  }
}

function showWelcome() {
  return [
    "👋 *Welcome!*",
    "I can take your pizza order.",
    "",
    menuText(),
    "",
    "Type *7* anytime to restart.",
  ].join("\n");
}

function summaryText(s) {
  return [
    "🧾 *Order Summary* ✅",
    `• Type: ${s.orderType}`,
    `• Item: ${s.item} x${s.qty}`,
    ...(s.orderType === "Delivery" && s.address
      ? [`• Address: ${s.address}`]
      : []),
    "",
    "Type *Confirm* to place the order, or *7* to restart.",
  ].join("\n");
}

// ----- Webhook Verify (GET) -----
app.get("/webhook", (req, res) => {
  try {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  } catch (e) {
    return res.sendStatus(500);
  }
});

// ----- Webhook Receive (POST) -----
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    // Support both test and real messages
    const msg = value?.messages?.[0];
    const from = msg?.from; // E.164
    if (!from) {
      return res.sendStatus(200);
    }

    // Extract text body (also handle button/interactive if needed later)
    let body = "";
    if (msg.type === "text") {
      body = msg.text.body || "";
    } else if (msg.type === "interactive") {
      const itype = msg.interactive?.type;
      body =
        itype === "button_reply"
          ? msg.interactive.button_reply?.title || ""
          : itype === "list_reply"
          ? msg.interactive.list_reply?.title || ""
          : "";
    }

    body = (body || "").trim();
    const lc = body.toLowerCase();

    // Shortcuts: restart / hello
    if (lc === "7" || lc === "restart" || lc === "menu") {
      sessions[from] = null;
      startSessionIfNeeded(from);
      await sendMessage(from, showWelcome());
      return res.sendStatus(200);
    }

    // New or greeting
    if (
      !sessions[from] ||
      ["hi", "hello", "hey", "start"].includes(lc)
    ) {
      startSessionIfNeeded(from);
      sessions[from].step = "menu";
      await sendMessage(from, showWelcome());
      return res.sendStatus(200);
    }

    // Continue existing flow
    const s = sessions[from];

    // Step: menu (choose item by number)
    if (s.step === "menu") {
      const chosen = MENU.find(m => m.code === lc || m.name.toLowerCase() === lc);
      if (!chosen) {
        await sendMessage(
          from,
          "Please pick an item by number.\n\n" + menuText()
        );
        return res.sendStatus(200);
      }
      s.item = chosen.name;
      s.step = "qty";
      await sendMessage(
        from,
        `How many *${s.item}*? (e.g., 1 or 2)`
      );
      return res.sendStatus(200);
    }

    // Step: qty
    if (s.step === "qty") {
      const n = parseInt(lc, 10);
      if (!Number.isFinite(n) || n <= 0) {
        await sendMessage(from, "Please enter a valid number for quantity (e.g., 1 or 2).");
        return res.sendStatus(200);
      }
      s.qty = n;
      s.step = "orderType";
      await sendMessage(
        from,
        [
          "Choose *Order Type*: ",
          "• *Delivery*",
          "• *Takeaway*",
          "• *Dine-in*",
          "",
          "Type one of the above."
        ].join("\n")
      );
      return res.sendStatus(200);
    }

    // Step: orderType
    if (s.step === "orderType") {
      const match = ORDER_TYPES.find(t => t.toLowerCase() === lc);
      if (!match) {
        await sendMessage(
          from,
          "Please type *Delivery*, *Takeaway*, or *Dine-in*."
        );
        return res.sendStatus(200);
      }
      s.orderType = match;

      if (s.orderType === "Delivery") {
        s.step = "address";
        await sendMessage(
          from,
          "Please share your *delivery address*."
        );
        return res.sendStatus(200);
      } else {
        s.step = "summary";
        await sendMessage(from, summaryText(s));
        return res.sendStatus(200);
      }
    }

    // Step: address (only for Delivery)
    if (s.step === "address") {
      if (!body) {
        await sendMessage(from, "Please enter a valid address for delivery.");
        return res.sendStatus(200);
      }
      s.address = body;
      s.step = "summary";
      await sendMessage(from, summaryText(s));
      return res.sendStatus(200);
    }

    // Step: summary -> confirm
    if (s.step === "summary") {
      if (lc === "confirm") {
        try {
          await saveToAirtable({
            phone: `+${from}`, // WhatsApp gives number without leading +
            itemName: s.item,
            qty: s.qty,
            orderType: s.orderType,
            address: s.address || "",
          });
          sessions[from] = null;
          await sendMessage(
            from,
            "🎉 *Your order has been placed successfully!* \nThank you! Type *menu* to order again."
          );
        } catch (err) {
          console.error("Airtable save error:", err?.response?.data || err.message);
          await sendMessage(
            from,
            "⚠️ Sorry, we couldn't save your order right now. Please try again."
          );
        }
        return res.sendStatus(200);
      } else {
        await sendMessage(
          from,
          "Please type *Confirm* to place the order, or *7* to restart."
        );
        return res.sendStatus(200);
      }
    }

    // Fallback
    await sendMessage(from, "Type *menu* to see options or *7* to restart.");
    return res.sendStatus(200);
  } catch (e) {
    console.error("Webhook error:", e?.response?.data || e.message);
    return res.sendStatus(200);
  }
});

// ----- Health -----
app.get("/health", (req, res) => res.status(200).send("ok"));

// ----- Start -----
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("Server listening on", PORT);
});
