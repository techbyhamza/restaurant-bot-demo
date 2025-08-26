// WhatsApp Restaurant Bot (Express + Cloud API)
// CommonJS (no "type":"module"), ready for Railway

const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN; // WhatsApp Cloud API token
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const PORT = process.env.PORT || 8080;

/* ----------------------------- Menu Data ----------------------------- */
// Categories shown first (single-digit choices), then items within that category
const CATEGORIES = [
  { id: "Mandi",    label: "Mandi",          emoji: "🍽️" },
  { id: "Curries",  label: "Curries",        emoji: "🍛" },
  { id: "Bread",    label: "Bread (Naan)",   emoji: "🥖" },
  { id: "Desserts", label: "Desserts",       emoji: "🍮" },
];

const ITEMS = [
  // Mandi
  { name: "Lamb Mandi (Single)",  price: 20, cat: "Mandi" },
  { name: "Lamb Mandi (Meal)",    price: 30, cat: "Mandi" },
  { name: "Red Mutton Mandi (Single)", price: 22, cat: "Mandi" },
  { name: "Red Mutton Mandi (Meal)",   price: 30, cat: "Mandi" },
  { name: "Chicken Mandi (Single)",    price: 20, cat: "Mandi" },
  { name: "Chicken Mandi (Meal)",      price: 30, cat: "Mandi" },
  { name: "Chicken 65 Mandi (Single)", price: 22, cat: "Mandi" },
  { name: "Chicken 65 Mandi (Meal)",   price: 30, cat: "Mandi" },
  { name: "Chicken Tikka Mandi (Single)", price: 22, cat: "Mandi" },
  { name: "Chicken Tikka Mandi (Meal)",   price: 30, cat: "Mandi" },
  { name: "Fish Mandi (Single)",  price: 22, cat: "Mandi" },
  { name: "Fish Mandi (Meal)",    price: 30, cat: "Mandi" },

  // Curries
  { name: "Mughlai Mutton", price: 20, cat: "Curries" },
  { name: "Dum ka Chicken", price: 20, cat: "Curries" },
  { name: "Lamb Marag Soup", price: 20, cat: "Curries" },
  { name: "Chicken Kadai",   price: 20, cat: "Curries" },
  { name: "Mutton Masala",   price: 20, cat: "Curries" },
  { name: "Butter Chicken",  price: 20, cat: "Curries" },

  // Bread (Naan)
  { name: "Plain Naan",        price: 2.5, cat: "Bread" },
  { name: "Butter Naan",       price: 3,   cat: "Bread" },
  { name: "Cheese Naan",       price: 4,   cat: "Bread" },
  { name: "Garlic Naan",       price: 4,   cat: "Bread" },
  { name: "Cheese Garlic Naan",price: 4.5, cat: "Bread" },

  // Desserts
  { name: "Fruit Custard",   price: 8, cat: "Desserts" },
  { name: "Gulab Jamun",     price: 8, cat: "Desserts" },
  { name: "Sitafal Cream",   price: 8, cat: "Desserts" },
  { name: "Mango Malai",     price: 8, cat: "Desserts" },
  { name: "Double ka Mithai",price: 8, cat: "Desserts" },
];

function byCategory(catId) { return ITEMS.filter(i => i.cat === catId); }

/* ----------------------------- UI Helpers ---------------------------- */
function mainMenuText() {
  let t = "🟩🟩🟩  *MATAAM AL ARABI — MENU*  🟩🟩🟩\n\n";
  t += "براہِ کرم کیٹیگری نمبر بھیجیں:\n";
  CATEGORIES.forEach((c, i) => { t += `${i + 1}) ${c.emoji} ${c.label}\n`; });
  t += "\nℹ️ مثال: *1* لکھیں Mandi کے لئے۔ دوبارہ مینیو کیلئے *menu* لکھیں۔";
  return t;
}

function categoryMenuText(catId) {
  const cat = CATEGORIES.find(c => c.id === catId);
  const items = byCategory(catId);
  let t = `🟦🟦🟦  *${cat.emoji} ${cat.label}*  🟦🟦🟦\n`;
  items.forEach((it, idx) => {
    const no = String(idx + 1).padStart(2, " ");
    t += `${no}) ${it.name} — $${it.price}\n`;
  });
  t += `\n🔙 *0* = Back   |   ℹ️ آئٹم کیلئے نمبر بھیجیں (مثلاً 1)`;
  return t;
}

/* --------------------------- Session (in-memory) --------------------- */
const SESS = new Map(); // wa_id -> { step, catId, itemIdx, qty }

function getS(wa) { if (!SESS.has(wa)) SESS.set(wa, { step: "idle" }); return SESS.get(wa); }
function resetS(wa) { SESS.set(wa, { step: "idle" }); }

/* ------------------------------ WhatsApp send ------------------------ */
async function sendText(wa_id, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: wa_id,
        text: { body: text }
      },
      { headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("sendText error:", e?.response?.data || e.message);
  }
}

/* ------------------------------ Webhook ------------------------------ */
// Verify
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Receive
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;
    if (body.object === "whatsapp_business_account") {
      const entry = body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;

      // messages (ignore statuses)
      const msg = value?.messages?.[0];
      if (msg) {
        const wa_id = msg.from; // sender phone (string)
        const text = (msg.text?.body || "").trim();
        await handleIncoming(wa_id, text);
      }
      return res.sendStatus(200);
    }
    res.sendStatus(404);
  } catch (e) {
    console.error("webhook error:", e);
    res.sendStatus(500);
  }
});

app.get("/", (_req, res) => res.send("OK — Restaurant bot is running"));

/* ------------------------------ Logic --------------------------------*/
async function handleIncoming(wa, text) {
  const s = getS(wa);

  // Hot commands
  if (/^(hi|hello|start|menu)$/i.test(text)) {
    s.step = "cat"; s.catId = null; s.itemIdx = null; s.qty = null;
    return sendText(wa, mainMenuText());
  }

  // Step: choose category
  if (s.step === "cat") {
    if (/^\d$/.test(text)) {
      const idx = parseInt(text, 10) - 1;
      if (idx >= 0 && idx < CATEGORIES.length) {
        s.catId = CATEGORIES[idx].id;
        s.step = "item";
        return sendText(wa, categoryMenuText(s.catId));
      }
    }
    return sendText(wa, "❌ درست کیٹیگری نمبر بھیجیں (مثلاً 1) یا *menu* لکھیں۔");
  }

  // Step: choose item within category
  if (s.step === "item" && s.catId) {
    if (text === "0") {
      s.step = "cat"; s.catId = null; s.itemIdx = null;
      return sendText(wa, mainMenuText());
    }
    if (/^\d{1,2}$/.test(text)) {
      const list = byCategory(s.catId);
      const idx = parseInt(text, 10) - 1;
      if (idx >= 0 && idx < list.length) {
        s.itemIdx = idx;
        s.step = "qty";
        const it = list[idx];
        return sendText(
          wa,
          `✅ *You selected:* ${it.name}\n💰 *Price:* $${it.price}\n\nبراہِ کرم *Quantity* لکھیں (مثلاً 1، 2، 3)`
        );
      }
    }
    return sendText(wa, "❌ درست آئٹم نمبر بھیجیں، یا *0* لکھ کر واپس جائیں۔");
  }

  // Step: quantity
  if (s.step === "qty" && s.catId != null && s.itemIdx != null) {
    if (/^\d{1,2}$/.test(text)) {
      const q = parseInt(text, 10);
      if (q > 0 && q < 100) {
        s.qty = q;
        s.step = "confirm";
        const it = byCategory(s.catId)[s.itemIdx];
        const total = (it.price * q).toFixed(2);
        return sendText(
          wa,
          `🧾 *Order Summary*\n• ${it.name}\n• Qty: ${q}\n• Total: *$${total}*\n\n` +
          `✅ کنفرم کیلئے *yes* لکھیں، یا *menu* لکھ کر دوبارہ شروع کریں۔`
        );
      }
    }
    return sendText(wa, "❌ Quantity صحیح لکھیں (1–99).");
  }

  // Step: confirm
  if (s.step === "confirm" && s.catId != null && s.itemIdx != null && s.qty) {
    if (text.toLowerCase() === "yes") {
      const it = byCategory(s.catId)[s.itemIdx];
      const total = (it.price * s.qty).toFixed(2);
      // TODO: یہاں اگر چاہیے تو Airtable/DB میں آرڈر سیو کریں
      await sendText(
        wa,
        `🎉 *آرڈر ریسیو ہوگیا!*\n• ${it.name} x ${s.qty}\n• Total: $${total}\n` +
        `مزید آرڈر کیلئے *menu* لکھیں۔`
      );
      return resetS(wa);
    }
    // کوئی اور جواب آیا تو مینیو پہ واپس
    resetS(wa);
    return sendText(wa, mainMenuText());
  }

  // Default: start flow
  s.step = "cat";
  return sendText(wa, mainMenuText());
}

/* ------------------------------ Start --------------------------------*/
app.listen(PORT, () => {
  console.log(`Mataam Al Arabi Bot running on port ${PORT}`);
});
