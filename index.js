// index.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { MessagingResponse } = require('twilio').twiml;

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

// -------- ENV -----------
const PORT = process.env.PORT || 3000;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_PAT;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || 'Orders';

// -------- In-memory sessions -----------
const sessions = {}; // phone -> { step, data }

// -------- Menus -----------
const MENUS = {
  "Al Noor Pizza": ["Margherita", "Pepperoni", "BBQ Chicken"],
  "First Choice": ["Zinger Burger", "Shawarma", "Club Sandwich"]
};

// -------- Airtable save -----------
async function saveToAirtable(fields) {
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID || !AIRTABLE_TABLE_NAME) {
    throw new Error("Airtable ENV missing");
  }
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`;
  const headers = {
    Authorization: `Bearer ${AIRTABLE_API_KEY}`,
    "Content-Type": "application/json"
  };
  const payload = {
    records: [{ fields }],
    typecast: true
  };
  const { data } = await axios.post(url, payload, { headers });
  return data?.records?.[0]?.id;
}

// -------- WhatsApp webhook -----------
app.post('/whatsapp', async (req, res) => {
  const twiml = new MessagingResponse();
  const from = (req.body.From || '').replace('whatsapp:', '');
  const body = (req.body.Body || '').trim();

  if (!sessions[from]) {
    // Start new session
    sessions[from] = { step: 'welcome', data: {} };
  }

  const session = sessions[from];

  try {
    if (session.step === 'welcome') {
      twiml.message(
        "👋 خوش آمدید! براہ کرم اپنا ریسٹورنٹ منتخب کریں:\n" +
        "1️⃣ Al Noor Pizza\n2️⃣ First Choice"
      );
      session.step = 'restaurant';
    }

    else if (session.step === 'restaurant') {
      if (body === '1' || /al\s*noor/i.test(body)) {
        session.data.restaurant = "Al Noor Pizza";
      } else if (body === '2' || /first\s*choice/i.test(body)) {
        session.data.restaurant = "First Choice";
      } else {
        twiml.message("براہ کرم درست انتخاب کریں: 1 یا 2");
        return res.type('text/xml').send(twiml.toString());
      }

      const menu = MENUS[session.data.restaurant]
        .map((item, i) => `${i + 1}. ${item}`).join("\n");

      twiml.message(
        `🍽 آپ نے منتخب کیا: ${session.data.restaurant}\n\nMenu:\n${menu}\n\nبراہ کرم آئٹم نمبر بھیجیں۔`
      );
      session.step = 'menu';
    }

    else if (session.step === 'menu') {
      const menu = MENUS[session.data.restaurant];
      const choice = parseInt(body, 10);
      if (isNaN(choice) || choice < 1 || choice > menu.length) {
        twiml.message("براہ کرم درست آئٹم نمبر منتخب کریں۔");
        return res.type('text/xml').send(twiml.toString());
      }
      session.data.item = menu[choice - 1];
      twiml.message(`آپ نے منتخب کیا: ${session.data.item}\nکتنی quantity چاہیے؟`);
      session.step = 'quantity';
    }

    else if (session.step === 'quantity') {
      const qty = parseInt(body, 10);
      if (isNaN(qty) || qty < 1) {
        twiml.message("براہ کرم درست quantity لکھیں (مثال: 2)");
        return res.type('text/xml').send(twiml.toString());
      }
      session.data.quantity = qty;
      twiml.message("کیا آپ dine-in کریں گے، takeaway یا booking؟");
      session.step = 'dining';
    }

    else if (session.step === 'dining') {
      const choice = body.toLowerCase();
      if (!['dine-in','takeaway','booking'].includes(choice)) {
        twiml.message("براہ کرم 'dine-in' یا 'takeaway' یا 'booking' لکھیں۔");
        return res.type('text/xml').send(twiml.toString());
      }
      session.data.dining = choice;
      twiml.message("ادائیگی کا طریقہ منتخب کریں:\n1. Pay at Counter\n2. Cash on Delivery\n3. Online Payment");
      session.step = 'payment';
    }

    else if (session.step === 'payment') {
      if (['1','pay','counter'].includes(body.toLowerCase())) {
        session.data.payment = "Pay at Counter";
      } else if (['2','cash','delivery'].includes(body.toLowerCase())) {
        session.data.payment = "Cash on Delivery";
      } else if (['3','online'].includes(body.toLowerCase())) {
        session.data.payment = "Online Payment";
      } else {
        twiml.message("براہ کرم 1، 2 یا 3 منتخب کریں۔");
        return res.type('text/xml').send(twiml.toString());
      }

      // Save in Airtable
      const fields = {
        "Phone Number": from,
        "Restaurant": session.data.restaurant,
        "Order Item": session.data.item,
        "Quantity": session.data.quantity,
        "Dining": session.data.dining,
        "Payment": session.data.payment,
        "Status": "Pending",
        "Order Time": new Date().toISOString()
      };

      try {
        const recId = await saveToAirtable(fields);
        console.log("✅ Airtable saved:", recId, fields);
      } catch (e) {
        console.error("Airtable error:", e?.response?.data || e.message);
      }

      twiml.message(
        `✅ آپ کا آرڈر کنفرم ہوگیا!\n\n` +
        `📍 ریسٹورنٹ: ${session.data.restaurant}\n` +
        `🍽 آئٹم: ${session.data.item}\n` +
        `🔢 Quantity: ${session.data.quantity}\n` +
        `🏠 Mode: ${session.data.dining}\n` +
        `💳 Payment: ${session.data.payment}\n\n` +
        `شکریہ!`
      );

      delete sessions[from]; // session ختم کر دیں
    }

    res.type('text/xml').send(twiml.toString());

  } catch (err) {
    console.error("Webhook error:", err);
    const fail = new MessagingResponse();
    fail.message("⚠️ سسٹم میں عارضی مسئلہ ہے۔");
    res.type('text/xml').send(fail.toString());
  }
});

// -------- Start -----------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
