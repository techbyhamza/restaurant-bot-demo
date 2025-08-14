require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

// ---------- Config ----------
const CONFIG = {
  alnoor: {
    name: "Al Noor Pizza & Grill",
    delivery: true, pickup: true, dinein: true,
    paymentNoteEN: "Pay online here and show at counter.",
    paymentOptions: ["COD","PAY_ONLINE","PAY_AT_COUNTER"],
    dineInPaymentOptions: ["PAY_AT_TABLE","PAY_ONLINE"],
    menu: [
      { code: "P1S", name_en: "Margherita (Small)", price: 10 },
      { code: "P1M", name_en: "Margherita (Medium)", price: 14 },
      { code: "P1L", name_en: "Margherita (Large)", price: 18 },
      { code: "P2M", name_en: "BBQ Chicken (Medium)", price: 16 },
      { code: "DS1", name_en: "Chocolate Brownie", price: 4 },
      { code: "DS2", name_en: "Ice Cream Cup", price: 4 },
    ],
  },
  firstchoice: {
    name: "First Choice Foods",
    delivery: true, pickup: true, dinein: true,
    paymentNoteEN: "Pay online here and show at counter.",
    paymentOptions: ["COD","PAY_ONLINE","PAY_AT_COUNTER"],
    dineInPaymentOptions: ["PAY_AT_TABLE","PAY_ONLINE"],
    menu: [
      { code: "BK1", name_en: "Zinger Burger", price: 9 },
      { code: "BK2", name_en: "Double Beef Burger", price: 12 },
      { code: "MN1", name_en: "Chicken Biryani", price: 10 },
      { code: "MN2", name_en: "Butter Chicken w/ Naan", price: 14 },
      { code: "DS1", name_en: "Chocolate Brownie", price: 4 },
      { code: "DS2", name_en: "Ice Cream Cup", price: 4 },
    ],
  },
};

const LANG = { EN: 'EN', UR: 'UR' };
const STAGE = {
  START: 'START',
  BRAND: 'BRAND',
  MODE: 'MODE',
  MENU: 'MENU',
  QTY: 'QTY',
  ADDRESS: 'ADDRESS',
  DINEIN_DATE: 'DINEIN_DATE',
  DINEIN_TIME: 'DINEIN_TIME',
  DINEIN_GUESTS: 'DINEIN_GUESTS',
  PAYMENT: 'PAYMENT',
  CONFIRM: 'CONFIRM',
  DONE: 'DONE',
};

const PAY_AT_COUNTER = "PAY_AT_COUNTER";
const PAY_AT_TABLE   = "PAY_AT_TABLE";

function twiml(res, text){
  res.set("Content-Type","application/xml");
  return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${esc(text)}</Message></Response>`);
}
function esc(s=""){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;"); }

const sessions = new Map();

function brandList(lang){
  const keys = Object.keys(CONFIG);
  const lines = keys.map((k,i)=> `${i+1}) ${CONFIG[k].name}`);
  const intro = "Select Restaurant:";
  return `${intro}\n\n${lines.join("\n")}\n\nSend the number of your choice.`;
}

function orderModes(lang, brandKey){
  const cfg = CONFIG[brandKey];
  const opts = [];
  if (cfg.delivery) opts.push("1) Delivery");
  if (cfg.pickup)   opts.push("2) Pickup");
  if (cfg.dinein)   opts.push("3) Dine-in (reservation)");
  return `Choose order type:\n${opts.join("\n")}\n\nUse 'back' or 'reset'.`;
}

function menuText(lang, brandKey){
  const cfg = CONFIG[brandKey];
  const lines = cfg.menu.map(it => `${it.code} — ${it.name_en} ($${it.price})`);
  return `${cfg.name} — Menu\nSend item code (e.g., P1M)\n\n${lines.join("\n")}\n\nUse 'back' or 'reset'.`;
}

function paymentText(lang, brandKey, forDineIn){
  const cfg = CONFIG[brandKey];
  const options = forDineIn ? (cfg.dineInPaymentOptions||[]) : (cfg.paymentOptions||[]);
  const labels = {
    "COD": "Cash on Delivery",
    "PAY_ONLINE": "Pay Online (link)",
    "PAY_AT_COUNTER": "Pay at Counter",
    "PAY_AT_TABLE": "Pay at Table"
  };
  const lines = options.map((o,i)=> `${i+1}) ${labels[o]}`);
  const note = cfg.paymentNoteEN ? `\n\n${cfg.paymentNoteEN}` : "";
  return `Select payment:\n${lines.join("\n")}${note}\n\nUse 'back' or 'reset'.`;
}

function summaryText(lang, brandKey, s){
  let out = `\n*Summary*\nRestaurant: ${CONFIG[brandKey].name}\nType: ${s.mode}\n`;
  if (s.mode==="Delivery" || s.mode==="Pickup"){
    const item = CONFIG[brandKey].menu.find(i=> i.code===s.itemCode);
    if (item){
      const total = item.price * Number(s.qty||1);
      out += `Item: ${item.name_en} x ${s.qty}\n`;
      if (s.mode==="Delivery") out += `Address: ${s.address}\n`;
      out += `Total: $${total}\n`;
    }
  } else {
    out += `Date: ${s.dineDate}\nTime: ${s.dineTime}\nGuests: ${s.dineGuests}\n`;
  }
  out += `Payment: ${s.payment}\n`;
  return out;
}

async function logToSheets(payload){
  const url = process.env.SHEETS_WEBAPP_URL;
  if (!url) return;
  try{
    await axios.post(url, payload);
  }catch(err){
    console.error("[Sheets] ERROR", err?.response?.status, err?.message);
  }
}

// ---------- Route ----------
app.post("/whatsapp", async (req, res) => {
  try {
    // Twilio x-www-form-urlencoded body کو پڑھنے کے لئے یہ لائن اوپر کہیں موجود ہونی چاہیے:
    // app.use(bodyParser.urlencoded({ extended: false }));

    const from = (req.body?.From || "").toString().trim();
    const body = (req.body?.Body || "").toString().trim();

    // ڈیبگ لاگ (Railway Deploy Logs میں نظر آئے گا)
    console.log("[WA] Incoming:", { from, body });

    // سادہ جواب: ہمیشہ زبان چننے کا مینو
    const reply = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Hi! Choose language:
1) Urdu
2) English

Send the number of your choice.</Message>
</Response>`;

    return res
      .status(200)
      .set("Content-Type", "application/xml")
      .send(reply);

  } catch (err) {
    console.error("[WA handler error]", err);
    // ایرر میں بھی Twilio کو valid XML ضرور بھیجیں
    return res
      .status(200)
      .set("Content-Type", "application/xml")
      .send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>Temporary error</Message></Response>`);
  }
});
// health check
app.get("/", (_req,res)=> res.type("text/plain").send("WhatsApp Restaurant Demo (minimal) running."));
const PORT = process.env.PORT || 8080;
app.listen(PORT, ()=> console.log("Server on", PORT));
