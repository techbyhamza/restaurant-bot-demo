const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

require("dotenv").config();

const app = express().use(bodyParser.json());

const token = process.env.ACCESS_TOKEN;      // Meta WhatsApp API Token
const verify_token = process.env.VERIFY_TOKEN;

const MENU = {
  categories: [
    {
      id: 1,
      name: "Mandi",
      items: [
        { code: 101, name: "Lamb Mandi (Single)", price: 20 },
        { code: 102, name: "Lamb Mandi (Meal)", price: 30 },
        { code: 103, name: "Red Mutton Mandi (Single)", price: 22 },
        { code: 104, name: "Red Mutton Mandi (Meal)", price: 30 },
        { code: 105, name: "Chicken Mandi (Single)", price: 20 },
        { code: 106, name: "Chicken Mandi (Meal)", price: 30 },
        { code: 107, name: "Chicken 65 Mandi (Single)", price: 22 },
        { code: 108, name: "Chicken 65 Mandi (Meal)", price: 30 },
        { code: 109, name: "Chicken Tikka Mandi (Single)", price: 22 },
        { code: 110, name: "Chicken Tikka Mandi (Meal)", price: 30 },
        { code: 111, name: "Fish Mandi (Single)", price: 22 },
        { code: 112, name: "Fish Mandi (Meal)", price: 30 }
      ]
    },
    {
      id: 2,
      name: "Mandi Deals",
      items: [
        { code: 201, name: "Mix Mandi Deal", price: 50 },
        { code: 202, name: "Mix Mandi Deal with Fish", price: 60 },
        { code: 203, name: "Family Mandi Medium", price: 90 },
        { code: 204, name: "Family Mandi Large", price: 120 },
        { code: 205, name: "Family Mandi XL (Extras)", price: 140 },
        { code: 206, name: "Lamb Shoulder Mandi Meal", price: 90 },
        { code: 207, name: "Lamb Shoulder Mix Mandi Meal", price: 120 }
      ]
    },
    {
      id: 3,
      name: "Lamb Biryani",
      items: [
        { code: 401, name: "Sufiyani Biryani", price: 20 },
        { code: 402, name: "Matka Sufiyani Biryani (Small)", price: 25 },
        { code: 403, name: "Matka Sufiyani Biryani (Medium)", price: 35 },
        { code: 404, name: "Matka Sufiyani Biryani (Large)", price: 55 },
        { code: 405, name: "Matka Parda Sufiyani Biryani", price: 65 }
      ]
    }
    // آپ مزید categories یہاں ڈال سکتے ہیں
  ]
};

// ✅ Root endpoint
app.get("/", (req, res) => {
  res.send("Mataam Al Arabi Bot is running 🚀");
});

// ✅ Webhook verification
app.get("/webhook", (req, res) => {
  let mode = req.query["hub.mode"];
  let token = req.query["hub.verify_token"];
  let challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === verify_token) {
      console.log("WEBHOOK_VERIFIED");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

// ✅ Webhook receiver
app.post("/webhook", (req, res) => {
  let body = req.body;

  if (body.object) {
    if (
      body.entry &&
      body.entry[0].changes &&
      body.entry[0].changes[0].value.messages &&
      body.entry[0].changes[0].value.messages[0]
    ) {
      let phone_number_id =
        body.entry[0].changes[0].value.metadata.phone_number_id;
      let from = body.entry[0].changes[0].value.messages[0].from;
      let msg_body =
        body.entry[0].changes[0].value.messages[0].text.body.toLowerCase();

      console.log("📩 User:", from, "Message:", msg_body);

      let reply = "";

      if (msg_body === "hi" || msg_body === "hello" || msg_body === "menu") {
        reply = "📋 *Welcome to Mataam Al Arabi!*\n\nSelect a category:\n";
        MENU.categories.forEach((cat) => {
          reply += `${cat.id}) ${cat.name}\n`;
        });
      } else if (!isNaN(msg_body)) {
        let num = parseInt(msg_body);
        let category = MENU.categories.find((c) => c.id === num);
        if (category) {
          reply = `🍴 *${category.name}*\n`;
          category.items.forEach((item) => {
            reply += `${item.code}) ${item.name} - $${item.price}\n`;
          });
        } else {
          // Check if it’s an item code
          let item;
          MENU.categories.forEach((cat) => {
            cat.items.forEach((it) => {
              if (it.code === num) item = it;
            });
          });
          if (item) {
            reply = `✅ You selected: ${item.name}\n💰 Price: $${item.price}\n\nPlease type your *Quantity*.`;
          } else {
            reply = "⚠️ Invalid option. Type 'menu' to see the menu again.";
          }
        }
      } else {
        reply = "👋 Type 'menu' to see our restaurant menu.";
      }

      axios({
        method: "POST",
        url:
          "https://graph.facebook.com/v17.0/" +
          phone_number_id +
          "/messages?access_token=" +
          token,
        data: {
          messaging_product: "whatsapp",
          to: from,
          text: { body: reply },
        },
        headers: { "Content-Type": "application/json" },
      }).catch((err) => console.error("❌ Error sending message:", err.response?.data || err.message));
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`✅ Mataam Al Arabi Bot running on port ${PORT}`);
});
