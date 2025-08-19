// index.js  (ESM)
// --- Env vars needed on Railway ---
// VERIFY_TOKEN      -> وہی جو آپ نے Meta Webhooks میں ڈالا ہے
// ACCESS_TOKEN      -> WhatsApp temporary/permanent access token
// PHONE_NUMBER_ID   -> WhatsApp "Phone number ID" (not the phone itself)

import express from "express";

const app = express();
app.use(express.json());

// Optional: basic health check
app.get("/", (req, res) => res.send("OK"));
app.get("/health", (req, res) => res.send("healthy"));

// ✅ Webhook verification (Meta calls this once when you press “Verify and save”)
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token && mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ✅ Incoming events/messages land here
app.post("/webhook", async (req, res) => {
  const body = req.body;
  console.log("🔔 Incoming webhook:", JSON.stringify(body, null, 2));

  // Always 200 quickly so Meta doesn’t retry
  res.sendStatus(200);

  try {
    const change = body?.entry?.[0]?.changes?.[0];
    const value = change?.value;
    const messages = value?.messages;

    // If a user message arrived
    if (Array.isArray(messages) && messages.length > 0) {
      const msg = messages[0];
      const from = msg.from; // WhatsApp number (international, no +)
      const text = msg.text?.body || "";

      console.log("📩 From:", from, "Text:", text);

      // Simple echo / greeting reply (you can plug your menu/flow here)
      const reply =
        text.trim().toLowerCase() === "hi" || text.trim().toLowerCase() === "hello"
          ? "Welcome 👋 Your WhatsApp API is connected!\nSend 'menu' to get options."
          : text.trim().toLowerCase() === "menu"
          ? "1) Burgers 🍔\n2) Pizza 🍕\n3) Drinks 🥤\nReply with a number."
          : "Got it! Reply 'menu' to see options.";

      await sendWhatsAppText(from, reply);
    }
  } catch (e) {
    console.error("❌ Handler error:", e);
  }
});

// --- Helper: send a WhatsApp text using Cloud API ---
async function sendWhatsAppText(to, bodyText) {
  const token = process.env.ACCESS_TOKEN;
  const phoneNumberId = process.env.PHONE_NUMBER_ID;

  const url = `https://graph.facebook.com/v23.0/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: bodyText },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error("❌ Send error:", resp.status, errText);
  } else {
    const data = await resp.json();
    console.log("✅ Sent:", JSON.stringify(data));
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
