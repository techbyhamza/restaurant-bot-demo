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
  const from = (req.body.From || "").trim();
  const body = (req.body.Body || "").trim();

  // ensure session
  let s = sessions.get(from);
  if (!s) { s = { stage: "START" }; sessions.set(from, s); }

  // reset
  if (body.toLowerCase() === "reset") {
    sessions.delete(from);
    return twiml(res, "Hi! Choose language:\n1) Urdu\n2) English\n\nSend the number of your choice.");
  }

  // back
  if (body.toLowerCase() === "back") {
    if (s.stage==="MODE") s.stage="BRAND";
    else if (s.stage==="MENU") s.stage="MODE";
    else if (s.stage==="QTY") s.stage="MENU";
    else if (s.stage==="ADDRESS") s.stage="QTY";
    else if (s.stage==="DINEIN_DATE") s.stage="MODE";
    else if (s.stage==="DINEIN_TIME") s.stage="DINEIN_DATE";
    else if (s.stage==="DINEIN_GUESTS") s.stage="DINEIN_TIME";
    else if (s.stage==="PAYMENT") s.stage=(s.mode==="Dine‑in"?"DINEIN_GUESTS":(s.mode==="Delivery"?"ADDRESS":"QTY"));
  }

  switch (s.stage){

    case "START": {
      // زبان بس placeholder، سیدھا برانڈ پر چلیں
      s.stage = "BRAND";
      return twiml(res, brandList());
    }

    case "BRAND": {
      const n = parseInt(body, 10);
      const keys = AVAILABLE;
      if (!n || n<1 || n>keys.length) return twiml(res, brandList());
      s.brandKey = keys[n-1];
      s.stage = "MODE";
      return twiml(res, orderModes(CONFIG[s.brandKey]));
    }

    case "MODE": {
      const cfg = CONFIG[s.brandKey];
      if (body==="1" && cfg.delivery)  { s.mode="Delivery"; s.stage="MENU";  return twiml(res, menuText(cfg)); }
      if (body==="2" && cfg.pickup)    { s.mode="Pickup";   s.stage="MENU";  return twiml(res, menuText(cfg)); }
      if (body==="3" && cfg.dinein)    { s.mode="Dine‑in";  s.stage="DINEIN_DATE"; return twiml(res,"Enter dine‑in date (YYYY‑MM‑DD)"); }
      return twiml(res, orderModes(cfg));
    }

    case "MENU": {
      const cfg = CONFIG[s.brandKey];
      const code = body.toUpperCase();
      const item = cfg.menu.find(m=>m.code===code);
      if (!item) return twiml(res, "Please send a valid item code.\n\n"+menuText(cfg));
      s.itemCode = code;
      s.stage = "QTY";
      return twiml(res, "Send quantity (1‑20)");
    }

    case "QTY": {
      const q = parseInt(body, 10);
      if (!q || q<1 || q>20) return twiml(res, "Please send a valid quantity (1‑20).");
      s.qty = q;
      if (s.mode==="Delivery"){ s.stage="ADDRESS"; return twiml(res,"Enter delivery address:"); }
      s.stage = "PAYMENT";
      return twiml(res, paymentText(CONFIG[s.brandKey], false));
    }

    case "ADDRESS": {
      if (!body || body.length<4) return twiml(res,"Please enter a complete address:");
      s.address = body;
      s.stage = "PAYMENT";
      return twiml(res, paymentText(CONFIG[s.brandKey], false));
    }

    case "DINEIN_DATE": {
      s.dineDate = body;
      s.stage = "DINEIN_TIME";
      return twiml(res,"Enter time (HH:MM 24h):");
    }

    case "DINEIN_TIME": {
      s.dineTime = body;
      s.stage = "DINEIN_GUESTS";
      return twiml(res,"Guests (1‑20):");
    }

    case "DINEIN_GUESTS": {
      const g = parseInt(body,10);
      if (!g || g<1 || g>20) return twiml(res,"Please send a valid number (1‑20).");
      s.dineGuests = g;
      s.stage = "PAYMENT";
      return twiml(res, paymentText(CONFIG[s.brandKey], true));
    }

    case "PAYMENT": {
      const cfg = CONFIG[s.brandKey];
      const opts = (s.mode==="Dine‑in" ? (cfg.dineInPaymentOptions||[]) : (cfg.paymentOptions||[]));
      const idx = parseInt(body,10)-1;
      if (idx<0 || idx>=opts.length) return twiml(res, paymentText(cfg, s.mode==="Dine‑in"));
      s.payment = opts[idx];
      s.stage = "CONFIRM";
      const text = "Type 'yes' to confirm, or 'back/reset'.\n\n"+summary(cfg, s);
      return twiml(res, text);
    }

    case "CONFIRM": {
      if (body.toLowerCase()==="yes"){
        // log to sheets (optional)
        logToSheets({
          from, brandKey: s.brandKey, brandName: CONFIG[s.brandKey].name,
          mode: s.mode, itemCode: s.itemCode || "", qty: s.qty || "",
          address: s.address || "", dineDate: s.dineDate || "", dineTime: s.dineTime || "",
          dineGuests: s.dineGuests || "", payment: s.payment || "",
          timestamp: new Date().toISOString()
        });
        sessions.delete(from);
        return twiml(res, "Thanks! Your request has been sent. Type 'hi' to start again.");
      }
      return twiml(res, "Please type 'yes' to confirm, or use 'back'/'reset'.");
    }

    default:
      sessions.delete(from);
      return twiml(res, "Hi! Choose language:\n1) Urdu\n2) English");
  }
});

app.get("/", (_req,res)=> res.type("text/plain").send("WhatsApp Restaurant Demo (minimal) running."));
const PORT = process.env.PORT || 8080;
app.listen(PORT, ()=> console.log("Server on", PORT));
