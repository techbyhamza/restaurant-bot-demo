// index.js
const express = require("express");

const app = express();
app.use(express.json());

// ----- Env Vars -----
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;         // e.g. "hamza-verify123"
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;         // temporary یا permanent
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;   // e.g. "740436365822100"

// ----- Health check -----
app.get("/", (req, res) => res.status(200).send("OK"));

// ----- Webhook Verification (GET) -----
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token && mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ WEBHOOK_VERIFIED");
    return res.status(200).send(challenge);
  }
  console.log("❌ WEBHOOK_VERIFY_FAILED");
  return res.sendStatus(403);
});

// ----- Incoming Messages (POST) -----
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    // WhatsApp notifications آتے ہی 200 دے دیں
    res.sendStatus(200);

    // Basic guard
    if (!body || body.object !== "whatsapp_business_account") return;

    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    // Message موجود ہے؟
    const messageObj = value?.messages?.[0];
    if (!messageObj) return;

    const from = messageObj.from; // sender msisdn (E.164)
    const msgType = messageObj.type;

    console.log("📩 Incoming:", JSON.stringify(messageObj, null, 2));

    // Simple auto-reply demo
    if (msgType === "text") {
      const text = messageObj.text?.body?.trim().toLowerCase() || "";

      if (text === "hi" || text === "hello" || text === "hey") {
        await sendText(from, "Hi Hamza! 👋 WhatsApp API is connected ✅");
      } else {
        await sendText(from, "Got it! ✅ (demo reply)");
      }
    }
  } catch (err) {
    console.error("Webhook error:", err);
  }
});

// ----- Send Text Helper -----
async function sendText(to, body) {
  const url = `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body }
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await resp.json();
  console.log("📤 Send response:", JSON.stringify(data, null, 2));
  return data;
}

// ----- Start server -----
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
