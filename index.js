import express from "express";

const app = express();
app.use(express.json());

// ---------- ENV ----------
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;           // Meta token (temp یا permanent)
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;     // مثال: 740436365822100
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "verify_me";
const PORT = process.env.PORT || 8080;

if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) {
  console.warn("⚠️ Missing ACCESS_TOKEN or PHONE_NUMBER_ID env");
}

// ---------- Helpers ----------
async function sendText(to, body) {
  const url = `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error("❌ Send error:", res.status, t);
  } else {
    const j = await res.json().catch(() => ({}));
    console.log("✅ Sent:", j);
  }
}

// ---------- Minimal in-memory state ----------
const S = new Map(); // key: from, values: step/item/qty

// ---------- Bot flow ----------
async function handleMessage(from, text) {
  const lower = (text || "").trim().toLowerCase();
  const step = S.get(from) || "START";

  // entry words
  if (["hi","hello","start","menu","hey","salam","salaam"].includes(lower) || step === "START") {
    S.set(from, "CHOOSE_REST");
    return sendText(
      from,
      "👋 Welcome!\nChoose a restaurant:\n1) Al Noor Pizza\n2) First Choice\n\nReply with *1* or *2*."
    );
  }

  if (step === "CHOOSE_REST") {
    if (lower === "1") {
      S.set(from, "MENU_PIZZA");
      return sendText(
        from,
        "🍕 *Al Noor Pizza Menu*\n1) Veg Pizza\n2) Chicken Pizza\n3) Garlic Bread\n4) Coke 1.25L\n\nSend item number."
      );
    }
    if (lower === "2") {
      S.set(from, "MENU_FIRST");
      return sendText(
        from,
        "🍛 *First Choice Menu*\n1) Chicken Biryani\n2) Chicken Karahi\n3) Naan\n4) Soft Drink\n\nSend item number."
      );
    }
    return sendText(from, "Please reply *1* or *2*.");
  }

  if (step === "MENU_PIZZA") {
    const item = ({"1":"Veg Pizza","2":"Chicken Pizza","3":"Garlic Bread","4":"Coke 1.25L"})[lower];
    if (!item) return sendText(from, "Reply 1‑4 to pick an item.");
    S.set(from, "ASK_QTY"); S.set(`${from}:item`, item);
    return sendText(from, `🧮 Quantity for *${item}*? (enter a number)`);
  }

  if (step === "MENU_FIRST") {
    const item = ({"1":"Chicken Biryani","2":"Chicken Karahi","3":"Naan","4":"Soft Drink"})[lower];
    if (!item) return sendText(from, "Reply 1‑4 to pick an item.");
    S.set(from, "ASK_QTY"); S.set(`${from}:item`, item);
    return sendText(from, `🧮 Quantity for *${item}*? (enter a number)`);
  }

  if (step === "ASK_QTY") {
    const qty = parseInt(lower, 10);
    if (!Number.isFinite(qty) || qty < 1) {
      return sendText(from, "Please send a valid quantity (e.g. 2).");
    }
    S.set(from, "CONFIRM"); S.set(`${from}:qty`, qty);
    const item = S.get(`${from}:item`);
    return sendText(
      from,
      `🧾 *Summary*\nItem: ${item}\nQty: ${qty}\n\nReply *confirm* to place order or *cancel* to restart.`
    );
  }

  if (step === "CONFIRM") {
    if (lower === "confirm") {
      const item = S.get(`${from}:item`);
      const qty = S.get(`${from}:qty`);
      // clear session
      S.delete(from); S.delete(`${from}:item`); S.delete(`${from}:qty`);
      return sendText(from, `🎉 Order placed: ${qty} × ${item}. Thanks!`);
    }
    if (lower === "cancel") {
      S.delete(from); S.delete(`${from}:item`); S.delete(`${from}:qty`);
      return sendText(from, `❌ Cancelled. Send *hi* to start again.`);
    }
    return sendText(from, `Please reply *confirm* or *cancel*.`);
  }

  // default
  return sendText(from, `Type *hi* to start.`);
}

// ---------- Webhook VERIFY (GET) ----------
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ---------- Webhook RECEIVE (POST) ----------
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const msg = value?.messages?.[0];

    if (msg) {
      const from = msg.from; // e.g. 61426....
      let text = "";
      if (msg.type === "text") text = msg.text?.body || "";
      else if (msg.type === "interactive") {
        const i = msg.interactive;
        text = i?.button_reply?.id || i?.list_reply?.id || "";
      }
      console.log("📩 IN:", { from, text });
      if (text) await handleMessage(from, text);
    }
  } catch (e) {
    console.error("Webhook error:", e);
  }
  res.sendStatus(200);
});

// ---------- Health ----------
app.get("/", (_req, res) => res.send("WhatsApp bot is running ✅"));

app.listen(PORT, () => console.log("🚀 Server listening on " + PORT));
