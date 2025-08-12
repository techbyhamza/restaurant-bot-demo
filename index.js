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
    const from = (req.body.From || "").trim();
    const body = (req.body.Body || "").trim();

    console.log("[WA] step0", { from, body, stage: (sessions.get(from)?.stage || "NEW") });

    try {
        // ensure session
        let s = sessions.get(from);
        if (!s) { 
            s = { stage: STAGE_START, lang: LANG.EN }; 
            sessions.set(from, s); 
        }

    // reset
    if (body.toLowerCase()==="reset"){
      sessions.delete(from);
      return twiml(res, "Hi! Choose language:\n1) Urdu\n2) English\n\nSend the number of your choice.");
    }

    // back
    if (body.toLowerCase()==="back"){
      if (s.stage===STAGE.MODE) s.stage=STAGE.BRAND;
      else if (s.stage===STAGE.MENU) s.stage=STAGE.MODE;
      else if (s.stage===STAGE.QTY) s.stage=STAGE.MENU;
      else if (s.stage===STAGE.ADDRESS) s.stage=STAGE.QTY;
      else if (s.stage===STAGE.DINEIN_DATE) s.stage=STAGE.MODE;
      else if (s.stage===STAGE.DINEIN_TIME) s.stage=STAGE.DINEIN_DATE;
      else if (s.stage===STAGE.DINEIN_GUESTS) s.stage=STAGE.DINEIN_TIME;
      else if (s.stage===STAGE.PAYMENT) s.stage=(s.mode==="Dine-in")?STAGE.DINEIN_GUESTS:STAGE.ADDRESS;
      else s.stage=STAGE.QTY;
    }

    switch (s.stage){
      case STAGE.START:{
        if (body==="1"){ s.lang=LANG.UR; s.stage=STAGE.BRAND; return twiml(res, brandList(s.lang)); }
        if (body==="2"){ s.lang=LANG.EN; s.stage=STAGE.BRAND; return twiml(res, brandList(s.lang)); }
        return twiml(res, "Hi! Choose language:\n1) Urdu\n2) English\n\nSend the number of your choice.");
      }

      case STAGE.BRAND:{
        const keys = Object.keys(CONFIG);
        const n = parseInt(body,10);
        if (!n || n<1 || n>keys.length) return twiml(res, brandList(s.lang));
        s.brandKey = keys[n-1];
        s.stage = STAGE.MODE;
        return twiml(res, orderModes(s.lang, s.brandKey));
      }

      case STAGE.MODE:{
        const sel = parseInt(body,10);
        if (sel===1){ s.mode="Delivery"; s.stage=STAGE.MENU; return twiml(res, menuText(s.lang, s.brandKey)); }
        if (sel===2){ s.mode="Pickup";   s.stage=STAGE.MENU; return twiml(res, menuText(s.lang, s.brandKey)); }
        if (sel===3){ s.mode="Dine-in";  s.stage=STAGE.DINEIN_DATE; return twiml(res, "Enter dine-in date (YYYY-MM-DD)"); }
        return twiml(res, orderModes(s.lang, s.brandKey));
      }

      case STAGE.MENU:{
        const item = CONFIG[s.brandKey].menu.find(i=> i.code===body.toUpperCase());
        if (!item) return twiml(res, "Please send a valid item code.\n\n"+menuText(s.lang, s.brandKey));
        s.itemCode = item.code;
        s.stage = STAGE.QTY;
        return twiml(res, "Send quantity (1–20)");
      }

      case STAGE.QTY:{
        const q = parseInt(body,10);
        if (!q || q<1 || q>20) return twiml(res, "Please send a valid quantity (1–20).");
        s.qty = q;
        if (s.mode==="Delivery"){ s.stage=STAGE.ADDRESS; return twiml(res, "Enter delivery address:"); }
        s.stage = STAGE.PAYMENT;
        return twiml(res, paymentText(s.lang, s.brandKey, false));
      }

      case STAGE.ADDRESS:{
        if (body.length<6) return twiml(res, "Please enter a complete address.");
        s.address = body;
        s.stage = STAGE.PAYMENT;
        return twiml(res, paymentText(s.lang, s.brandKey, false));
      }

      case STAGE.DINEIN_DATE:{ s.dineDate=body; s.stage=STAGE.DINEIN_TIME; return twiml(res,"Enter time (HH:MM) 24h"); }
      case STAGE.DINEIN_TIME:{ s.dineTime=body; s.stage=STAGE.DINEIN_GUESTS; return twiml(res,"Guests (1–20)?"); }
      case STAGE.DINEIN_GUESTS:{
        const g = parseInt(body,10); if (!g||g<1||g>20) return twiml(res,"Please send a valid number (1–20).");
        s.dineGuests=g; s.stage=STAGE.PAYMENT; return twiml(res, paymentText(s.lang, s.brandKey, true));
      }

      case STAGE.PAYMENT:{
        const cfg = CONFIG[s.brandKey];
        const options = (s.mode==="Dine-in" ? (cfg.dineInPaymentOptions||[]) : (cfg.paymentOptions||[]));
        const idx = parseInt(body,10)-1;
        if (idx<0 || idx>=options.length) return twiml(res, paymentText(s.lang, s.brandKey, s.mode==="Dine-in"));
        s.payment = options[idx] || options[idx];
        s.stage = STAGE.CONFIRM;
        return twiml(res, "Type 'yes' to confirm, or 'back/reset'.\n"+summaryText(s.lang, s.brandKey, s));
      }

      case STAGE.CONFIRM:{
        if (body.toLowerCase()==="yes"){
          // log to sheets (optional)
          logToSheets({
            from, brandKey: s.brandKey, brandName: CONFIG[s.brandKey].name,
            mode: s.mode, itemCode: s.itemCode || "", qty: s.qty || "",
            address: s.address || "", dineDate: s.dineDate || "", dineTime: s.dineTime || "",
            dineGuests: s.dineGuests || "", payment: s.payment || "", timestamp: new Date().toISOString()
          });
          sessions.delete(from);
          return twiml(res, "Thanks! Your request has been sent. Type 'hi' to start again.");
        }
        return twiml(res, "Please type 'yes' to confirm, or use 'back/reset'.\n"+summaryText(s.lang, s.brandKey, s));
      }

      default:{
        sessions.delete(from);
        return twiml(res, "Hi! Choose language:\n1) Urdu\n2) English");
      }
    }

  }catch(err){
    console.error("[WA handler error]", err);
    // Twilio must always get a 200 with XML
    res
      .status(200)
      .set("Content-Type","application/xml")
      .send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>Temporary error</Message></Response>`);
  }
});

// health check
app.get("/", (_req,res)=> res.type("text/plain").send("WhatsApp Restaurant Demo (minimal) running."));
const PORT = process.env.PORT || 8080;
app.listen(PORT, ()=> console.log("Server on", PORT));
