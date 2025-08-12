require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

// ---- Config (دو ڈمی برانڈز مثال کیلئے) ----
const CONFIG = {
  alnoor: {
    name: "Al Noor Pizza & Grill",
    delivery: true, pickup: true, dinein: true,
    paymentOptions: ["COD", "PAY_ONLINE", "PAY_AT_COUNTER"],
    dineInPaymentOptions: ["PAY_AT_TABLE", "PAY_ONLINE"],
    menu: [
      { code: "P1S", name_en: "Margherita (Small)", price: 10 },
      { code: "P1M", name_en: "Margherita (Medium)", price: 14 },
      { code: "P1L", name_en: "Margherita (Large)", price: 18 },
      { code: "P2M", name_en: "BBQ Chicken (Medium)", price: 16 },
      { code: "B1",  name_en: "Zinger Burger", price: 9 },
      { code: "B2",  name_en: "Double Beef Burger", price: 12 },
      { code: "DS1", name_en: "Chocolate Brownie", price: 4 },
      { code: "DS2", name_en: "Ice Cream Cup", price: 4 }
    ]
  },
  firstchoice: {
    name: "First Choice Foods",
    delivery: true, pickup: true, dinein: true,
    paymentOptions: ["COD", "PAY_ONLINE", "PAY_AT_COUNTER"],
    dineInPaymentOptions: ["PAY_AT_TABLE", "PAY_ONLINE"],
    menu: [
      { code: "BK1", name_en: "Zinger Burger", price: 9 },
      { code: "MN1", name_en: "Chicken Biryani", price: 10 },
      { code: "MN2", name_en: "Butter Chicken w/ Naan", price: 14 },
      { code: "DS1", name_en: "Chocolate Brownie", price: 4 },
      { code: "DS2", name_en: "Ice Cream Cup", price: 4 }
    ]
  }
};

// چاہیں تو ENV میں "alnoor,firstchoice" دے دیں، ورنہ دونوں
const AVAILABLE = (process.env.RESTAURANTS || "alnoor,firstchoice")
  .split(",").map(s => s.trim()).filter(Boolean);

// ---- Helpers ----
const sessions = new Map(); // per WhatsApp number

function twiml(res, text) {
  res.set('Content-Type', 'application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(text)}</Message></Response>`);
}
function escapeXml(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");}

function brandList() {
  const lines = AVAILABLE.map((k,i)=> `${i+1}) ${CONFIG[k].name}`);
  return `Select Restaurant:\n${lines.join('\n')}\n\nSend the number of your choice.`;
}

function orderModes(cfg){
  const opts = [];
  if (cfg.delivery) opts.push("1) Delivery");
  if (cfg.pickup)   opts.push("2) Pickup");
  if (cfg.dinein)   opts.push("3) Dine‑in (reservation)");
  return `Choose order type:\n${opts.join('\n')}\n\nSend number (e.g., 1) or type 'back' / 'reset'.`;
}

function menuText(cfg){
  const lines = cfg.menu.map(it => `• ${it.code} — ${it.name_en} ($${it.price})`);
  return `Send item code (e.g., P1M)\n\n${cfg.name} — Menu\n${lines.join('\n')}\n\nUse 'back' or 'reset'.`;
}

function paymentText(cfg, forDine=false){
  const opts = forDine ? (cfg.dineInPaymentOptions||[]) : (cfg.paymentOptions||[]);
  const labels = { COD:"Cash on Delivery", PAY_ONLINE:"Pay Online (link)", PAY_AT_COUNTER:"Pay at Counter", PAY_AT_TABLE:"Pay at Table" };
  const lines = opts.map((k,i)=> `${i+1}) ${labels[k]}`);
  return `Select payment:\n${lines.join('\n')}\n\nUse 'back' or 'reset'.`;
}

function summary(cfg, s){
  let out = `Restaurant: ${cfg.name}\nType: ${s.mode}\n`;
  if (s.mode==="Delivery" || s.mode==="Pickup"){
    const item = cfg.menu.find(i=>i.code===s.itemCode);
    if (item){
      const total = item.price * Number(s.qty||1);
      out += `Item: ${item.name_en} x ${s.qty}\n`;
      if (s.mode==="Delivery") out += `Address: ${s.address}\n`;
      out += `Total: $${total}\n`;
    }
  } else {
    out += `Date: ${s.dineDate}\nTime: ${s.dineTime}\nGuests: ${s.dineGuests}\n`;
  }
  out += `Payment: ${s.payment}`;
  return out;
}

async function logToSheets(payload){
  const url = process.env.SHEETS_WEBAPP_URL;
  if (!url) return;
  try{
    await axios.post(url, payload);
  }catch(err){
    // خاموش fail (بس ڈپلائے لاگز میں دیکھنا ہو تو کھول لیں)
    console.error("[Sheets] ERROR", err?.response?.status, err?.message);
  }
}

// ---- Route ----
app.post("/whatsapp", async (req, res) => {
  try {
    // صرف ٹیسٹ لاگ
    console.log("[WA] Incoming:", req.body?.From, "| Body:", req.body?.Body);

    // لازمی XML ریسپانس
    const reply = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Hi! I received: ${ (req.body?.Body || "").toString().trim() }</Message>
</Response>`;

    res
      .status(200)
      .set("Content-Type", "application/xml")
      .send(reply);
  } catch (err) {
    console.error("WA handler error", err);
    // even on error, Twilio must get something
    res
      .status(200)
      .set("Content-Type", "application/xml")
      .send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>Temporary error</Message></Response>`);
  }
});

app.get("/", (_req,res)=> res.type("text/plain").send("WhatsApp Restaurant Demo (minimal) running."));
const PORT = process.env.PORT || 8080;
app.listen(PORT, ()=> console.log("Server on", PORT));
