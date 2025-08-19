import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- ENV (Railway Variables) ---
const VERIFY_TOKEN   = process.env.VERIFY_TOKEN;     // e.g. hamza-verify-123
const ACCESS_TOKEN   = process.env.ACCESS_TOKEN;     // Meta temp/permanent token
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID; // e.g. 740436365822100

// Health check
app.get("/", (_req, res) => res.send("OK - bot is running"));

// --- Webhook Verify (GET) ---
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// --- Webhook Receive (POST) ---
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    // WhatsApp messages live in: entry[0].changes[0].value.messages
    const change = body?.entry?.[0]?.changes?.[0]?.value;
    const messages = change?.messages;

    if (messages && messages.length > 0) {
      const msg = messages[0];
      const from = msg.from;                   // sender wa-id (phone)
      const text = msg.text?.body || "";       // user text (if text message)

      // --- Send a simple reply back ---
      if (from && ACCESS_TOKEN && PHONE_NUMBER_ID) {
        const url = `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`;
        await axios.post(
          url,
          {
            messaging_product: "whatsapp",
            to: from,
            text: { body: text ? `Got it: ${text}` : "Hello! 👋 Bot is live." }
          },
          { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
        );
      }
    }

    // Always 200 quickly so Meta doesn’t retry
    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook POST error:", err?.response?.data || err.message);
    res.sendStatus(200);
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
