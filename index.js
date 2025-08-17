// index.js

import express from "express";
import bodyParser from "body-parser";
import Airtable from "airtable";
import twilio from "twilio";

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// 🔹 Env Variables
const {
  AIRTABLE_BASE_ID,
  AIRTABLE_PAT,
  AIRTABLE_TABLE_NAME,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM,
} = process.env;

// 🔹 Airtable Client
const base = new Airtable({ apiKey: AIRTABLE_PAT }).base(AIRTABLE_BASE_ID);

// 🔹 Twilio Client
const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Root check
app.get("/", (req, res) => {
  res.send("✅ WhatsApp Bot is running with Airtable!");
});

// WhatsApp webhook
app.post("/whatsapp", async (req, res) => {
  try {
    const incomingMsg = req.body.Body ? req.body.Body.trim().toLowerCase() : "";
    const from = req.body.From;

    let reply = "❓ Sorry, I didn’t understand that. Reply with 'menu'.";

    if (incomingMsg === "hi" || incomingMsg === "hello") {
      reply =
        "👋 Welcome to Al Noor Pizza!\nType 'menu' to see our items.";
    } else if (incomingMsg === "menu") {
      reply = "📋 Our Menu:\n1. Veg Pizza\n2. Chicken Pizza\n3. Drinks\n\nReply with item name to order.";
    } else if (
      incomingMsg.includes("pizza") ||
      incomingMsg.includes("drink")
    ) {
      // Save order in Airtable
      await base(AIRTABLE_TABLE_NAME).create([
        {
          fields: {
            Customer: from,
            Item: incomingMsg,
            Status: "Open",
          },
        },
      ]);
      reply = `✅ Your order for "${incomingMsg}" has been placed!`;
    }

    // Send reply back to WhatsApp
    await client.messages.create({
      from: TWILIO_WHATSAPP_FROM,
      to: from,
      body: reply,
    });

    res.send("OK");
  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).send("Error processing request");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
