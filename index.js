
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

const PORT = process.env.PORT;
const SHEETS_WEBAPP_URL = process.env.SHEETS_WEBAPP_URL || "";

// ---- Brand Config (tailored) ----
const CONFIG = {
  alnoor: {
    name: "Al Noor Pizza & Grill",
    delivery: true,
    pickup: true,
    dinein: true,
    // Manual online payment note (you can change the link)
    paymentNoteEN: "Pay online here and send screenshot: https://pay.example.com/alnoor",
    paymentNoteUR: "آن لائن ادائیگی کریں اور اسکرین شاٹ بھیجیں: https://pay.example.com/alnoor",
    // Payments: Cash on Delivery + Pay Online + Pay at Counter (on arrival)
    paymentOptions: ["COD","PAY_ONLINE","PAY_AT_COUNTER"],
    // Dine-in payments: Pay at Table (on arrival) + Pay Online
    dineInPaymentOptions: ["PAY_AT_TABLE","PAY_ONLINE"],
    menu: [
      { code: "P1S", name_en: "Margherita (Small)", name_ur: "مارگریٹا (سمال)", price: 10 },
      { code: "P1M", name_en: "Margherita (Medium)", name_ur: "مارگریٹا (میڈیم)", price: 14 },
      { code: "P1L", name_en: "Margherita (Large)", name_ur: "مارگریٹا (لارج)", price: 18 },
      { code: "P2M", name_en: "BBQ Chicken (Medium)", name_ur: "بی بی کیو چکن (میڈیم)", price: 16 },
      { code: "P3L", name_en: "Veggie Supreme (Large)", name_ur: "ویجی سپریم (لارج)", price: 19 },
      { code: "B1", name_en: "Chicken Burger", name_ur: "چکن برگر", price: 9 },
      { code: "B2", name_en: "Beef Cheese Burger", name_ur: "بیف چیز برگر", price: 11 },
      { code: "W1", name_en: "Chicken Wrap", name_ur: "چکن ریپ", price: 8 },
      { code: "S1", name_en: "Garlic Bread", name_ur: "گارلک بریڈ", price: 5 },
      { code: "S2", name_en: "Cheesy Fries", name_ur: "چیزی فرائز", price: 6 },
      { code: "D1", name_en: "Soft Drink Can", name_ur: "سافٹ ڈرنک کین", price: 3 },
      { code: "D2", name_en: "1.25L Drink", name_ur: "1.25 لیٹر ڈرنک", price: 5 },
      { code: "DS1", name_en: "Chocolate Brownie", name_ur: "چاکلیٹ براؤنی", price: 4 },
      { code: "DS2", name_en: "Ice Cream Cup", name_ur: "آئس کریم کپ", price: 4 }
    ]
  },
  firstchoice: {
    name: "First Choice Foods",
    // Delivery also enabled as requested
    delivery: true,
    pickup: true,
    dinein: true,
    paymentNoteEN: "Pay online here and show at counter: https://pay.example.com/firstchoice",
    paymentNoteUR: "آن لائن ادائیگی کریں اور کاؤنٹر پر دکھائیں: https://pay.example.com/firstchoice",
    paymentOptions: ["COD","PAY_ONLINE","PAY_AT_COUNTER"],
    dineInPaymentOptions: ["PAY_AT_TABLE","PAY_ONLINE"],
    menu: [
      { code: "BK1", name_en: "Zinger Burger", name_ur: "زنگر برگر", price: 9 },
      { code: "BK2", name_en: "Double Beef Burger", name_ur: "ڈبل بیف برگر", price: 12 },
      { code: "WR1", name_en: "Peri Peri Wrap", name_ur: "پیری پیری ریپ", price: 8 },
      { code: "MN1", name_en: "Chicken Biryani", name_ur: "چکن بریانی", price: 10 },
      { code: "MN2", name_en: "Butter Chicken w/ Naan", name_ur: "بٹر چکن نان کے ساتھ", price: 14 },
      { code: "SD1", name_en: "Masala Fries", name_ur: "مسالا فرائز", price: 5 },
      { code: "DR1", name_en: "Mint Margarita", name_ur: "منٹ مارگریٹا", price: 4 },
      { code: "DZ1", name_en: "Kheer Cup", name_ur: "کھیر کپ", price: 4 }
    ]
  }
};

const LANG = { EN: "EN", UR: "UR" };
const STAGE = {
  START: "START",
  BRAND: "BRAND",
  MODE: "MODE", // Delivery / Pickup / Dine-in
  MENU: "MENU",
  QTY: "QTY",
  ADDRESS: "ADDRESS",
  DINEIN_DATE: "DINEIN_DATE",
  DINEIN_TIME: "DINEIN_TIME",
  DINEIN_GUESTS: "DINEIN_GUESTS",
  PAYMENT: "PAYMENT",
  CONFIRM: "CONFIRM",
  DONE: "DONE"
};

const sessions = new Map();

function esc(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");}
function twiml(res, txt){res.set("Content-Type","application/xml");res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${esc(txt)}</Message></Response>`);}

function brandList(lang){
  const keys = Object.keys(CONFIG);
  const lines = keys.map((k,i)=> `${i+1}) ${CONFIG[k].name}`);
  return (lang===LANG.UR)? `*ریسٹورنٹ منتخب کریں*\n${lines.join("\n")}\n\nاپنی پسند کا نمبر بھیجیں۔`
                          : `*Select Restaurant*\n${lines.join("\n")}\n\nSend the number of your choice.`;
}
function orderModes(lang, brandKey){
  const cfg = CONFIG[brandKey]; const opts = [];
  if (cfg.delivery) opts.push(lang===LANG.UR? "1) ڈلیوری":"1) Delivery");
  if (cfg.pickup)   opts.push(lang===LANG.UR? "2) پِک اپ":"2) Pickup");
  if (cfg.dinein)   opts.push(lang===LANG.UR? "3) ڈائن اِن (ریزرویشن)":"3) Dine-in (reservation)");
  return (lang===LANG.UR)? `*آرڈر ٹائپ منتخب کریں*\n${opts.join("\n")}\n\n'back' یا 'reset' استعمال کریں۔`
                          : `*Choose order type*\n${opts.join("\n")}\n\nUse 'back' or 'reset'.`;
}
function menuText(lang, brandKey){
  const cfg = CONFIG[brandKey];
  const lines = cfg.menu.map(it=> `• ${it.code} — ${(lang===LANG.UR? it.name_ur:it.name_en)} ($${it.price})`);
  return (lang===LANG.UR)? `*${cfg.name} — مینو*\nآئٹم کوڈ لکھیں (مثلاً P1M)\n${lines.join("\n")}\n\n'back' یا 'reset' استعمال کریں۔`
                          : `*${cfg.name} — Menu*\nSend item code (e.g., P1M)\n${lines.join("\n")}\n\nUse 'back' or 'reset'.`;
}
function paymentText(lang, brandKey, forDine=false){
  const cfg = CONFIG[brandKey];
  const options = forDine ? (cfg.dineInPaymentOptions||[]) : (cfg.paymentOptions||[]);
  const labels = { COD:"Cash on Delivery", PAY_ONLINE:"Pay Online (link)", PAY_AT_COUNTER:"Pay at Counter", PAY_AT_TABLE:"Pay at Table" };
  const lines = options.map((o,i)=> `${i+1}) ${labels[o]}`);
  const note = (lang===LANG.UR)? cfg.paymentNoteUR : cfg.paymentNoteEN;
  return (lang===LANG.UR)? `*ادائیگی منتخب کریں*\n${lines.join("\n")}\n\n${note}\n'back' یا 'reset' استعمال کریں۔`
                          : `*Choose payment*\n${lines.join("\n")}\n\n${note}\nUse 'back' or 'reset'.`;
}
function summaryText(lang, brandKey, s){
  const cfg = CONFIG[brandKey];
  let out = (lang===LANG.UR? "*سمری*\n":"*Summary*\n");
  out += (lang===LANG.UR? `ریسٹورنٹ: ${cfg.name}\n`:`Restaurant: ${cfg.name}\n`);
  out += (lang===LANG.UR? `ٹائپ: ${s.mode}\n`:`Type: ${s.mode}\n`);
  if (s.mode==="Delivery" || s.mode==="Pickup"){
    const item = cfg.menu.find(i=>i.code===s.itemCode);
    if (item){
      const label = (s.lang===LANG.UR? item.name_ur:item.name_en);
      const total = item.price * Number(s.qty||1);
      out += (lang===LANG.UR? `آئٹم: ${label} x ${s.qty}\n`:`Item: ${label} x ${s.qty}\n`);
      if (s.mode==="Delivery") out += (lang===LANG.UR? `ایڈریس: ${s.address}\n`:`Address: ${s.address}\n`);
      out += (lang===LANG.UR? `کل: $${total}\n`:`Total: $${total}\n`);
    }
  } else {
    out += (lang===LANG.UR? `تاریخ: ${s.dineDate}\nوقت: ${s.dineTime}\nافراد: ${s.dineGuests}\n`
                           : `Date: ${s.dineDate}\nTime: ${s.dineTime}\nGuests: ${s.dineGuests}\n`);
  }
  out += (lang===LANG.UR? `ادائیگی: ${s.payment}\n`:`Payment: ${s.payment}\n`);
  return out;
}
function logToSheets(payload){
  if (!SHEETS_WEBAPP_URL) {
    console.error("[Sheets] URL missing");
    return;
  }
  console.log("[Sheets] POST ->", SHEETS_WEBAPP_URL, JSON.stringify(payload));
  axios.post(SHEETS_WEBAPP_URL, payload)
    .then(r => console.log("[Sheets] OK", r.status, typeof r.data === "string" ? r.data : JSON.stringify(r.data)))
    .catch(err => {
      const st   = err.response?.status;
      const body = err.response?.data || err.message;
      console.error("[Sheets] ERROR", st, body);
    });
}
app.post("/whatsapp", (req,res)=>{
 console.log("[WA] Incoming:", req.body?.From, "| Body:", (req.body?.Body || "").toString());

 const from = req.body.From || "";
 const body = (req.body.Body || "").trim();
  let s = sessions.get(from);

  if (body.toLowerCase()==="reset"){ s = { stage: "START" }; sessions.set(from, s); }
  if (!s){ s = { stage: "START" }; sessions.set(from, s); }

  if (body.toLowerCase()==="back"){
    if (s.stage==="MODE") s.stage="BRAND";
    else if (s.stage==="MENU") s.stage="MODE";
    else if (s.stage==="QTY") s.stage="MENU";
    else if (s.stage==="ADDRESS") s.stage="QTY";
    else if (s.stage==="DINEIN_DATE") s.stage="MODE";
    else if (s.stage==="DINEIN_TIME") s.stage="DINEIN_DATE";
    else if (s.stage==="DINEIN_GUESTS") s.stage="DINEIN_TIME";
    else if (s.stage==="PAYMENT"){
      if (s.mode==="Dine-in") s.stage="DINEIN_GUESTS";
      else if (s.mode==="Delivery") s.stage="ADDRESS";
      else s.stage="QTY";
    }
  }

  switch (s.stage){
    case "START":{
      if (body==="1"){ s.lang="UR"; s.stage="BRAND"; return twiml(res, brandList(s.lang)); }
      if (body==="2"){ s.lang="EN"; s.stage="BRAND"; return twiml(res, brandList(s.lang)); }
      return twiml(res, "Hi! Choose language:\n1) Urdu\n2) English\n\nSend the number of your choice.");
    }
    case "BRAND":{
      const keys = Object.keys(CONFIG);
      const n = parseInt(body,10);
      if (!n || n<1 || n>keys.length) return twiml(res, brandList(s.lang||"EN"));
      s.brandKey = keys[n-1];
      s.stage = "MODE";
      return twiml(res, orderModes(s.lang||"EN", s.brandKey));
    }
    case "MODE":{
      const cfg = CONFIG[s.brandKey];
      const opts = []; if (cfg.delivery) opts.push("Delivery"); if (cfg.pickup) opts.push("Pickup"); if (cfg.dinein) opts.push("Dine-in");
      const idx = parseInt(body,10)-1; const sel = opts[idx];
      if (!sel) return twiml(res, orderModes(s.lang||"EN", s.brandKey));
      s.mode = sel;
      if (sel==="Delivery" || sel==="Pickup"){ s.stage="MENU"; return twiml(res, menuText(s.lang||"EN", s.brandKey)); }
      s.stage="DINEIN_DATE"; return twiml(res, s.lang==="UR" ? "ڈائن اِن کی تاریخ (YYYY-MM-DD) لکھیں:" : "Enter dine-in date (YYYY-MM-DD):");
    }
    case "MENU":{
      const cfg = CONFIG[s.brandKey];
      const code = body.toUpperCase();
      const item = cfg.menu.find(i=>i.code===code);
      if (!item) return twiml(res, (s.lang==="UR"?"براہ کرم درست آئٹم کوڈ بھیجیں۔\n\n":"Please send a valid item code.\n\n")+menuText(s.lang||"EN", s.brandKey));
      s.itemCode = item.code;
      s.stage="QTY"; return twiml(res, s.lang==="UR" ? "مقدار لکھیں (1–20):" : "Send quantity (1–20):");
    }
    case "QTY":{
      const q = parseInt(body,10);
      if (isNaN(q)||q<1||q>20) return twiml(res, s.lang==="UR"?"براہ کرم درست مقدار (1–20) لکھیں۔":"Please send a valid quantity (1–20).");
      s.qty = q;
      if (s.mode==="Delivery"){ s.stage="ADDRESS"; return twiml(res, s.lang==="UR"?"ڈلیوری ایڈریس لکھیں:":"Enter delivery address:"); }
      s.stage="PAYMENT"; return twiml(res, paymentText(s.lang||"EN", s.brandKey, false));
    }
    case "ADDRESS":{
      if (body.length<4) return twiml(res, s.lang==="UR"?"براہ کرم مکمل ایڈریس لکھیں۔":"Please enter a complete address.");
      s.address = body; s.stage="PAYMENT"; return twiml(res, paymentText(s.lang||"EN", s.brandKey, false));
    }
    case "DINEIN_DATE":{ s.dineDate=body; s.stage="DINEIN_TIME"; return twiml(res, s.lang==="UR"?"وقت لکھیں (HH:MM) 24h:":"Enter time (HH:MM) 24h:"); }
    case "DINEIN_TIME":{ s.dineTime=body; s.stage="DINEIN_GUESTS"; return twiml(res, s.lang==="UR"?"افراد کی تعداد لکھیں (1–20):":"Guests (1–20):"); }
    case "DINEIN_GUESTS":{
      const g = parseInt(body,10);
      if (isNaN(g)||g<1||g>20) return twiml(res, s.lang==="UR"?"براہ کرم درست تعداد (1–20) لکھیں۔":"Please send a valid number (1–20).");
      s.dineGuests=g; s.stage="PAYMENT"; return twiml(res, paymentText(s.lang||"EN", s.brandKey, true));
    }
    case "PAYMENT":{
      const cfg = CONFIG[s.brandKey];
      const forDine = s.mode==="Dine-in";
      const options = forDine ? (cfg.dineInPaymentOptions||[]) : (cfg.paymentOptions||[]);
      const idx = parseInt(body,10)-1;
      if (idx<0 || idx>=options.length) return twiml(res, paymentText(s.lang||"EN", s.brandKey, forDine));
      const map = { COD:"Cash on Delivery", PAY_ONLINE:"Pay Online", PAY_AT_COUNTER:"Pay at Counter", PAY_AT_TABLE:"Pay at Table" };
      s.payment = map[options[idx]] || options[idx];
      s.stage="CONFIRM";
      return twiml(res, (s.lang==="UR"?"تصدیق کیلئے 'yes' لکھیں، یا 'back/reset'.\n\n":"Type 'yes' to confirm, or 'back/reset'.\n\n") + summaryText(s.lang||"EN", s.brandKey, s));
    }
    case "CONFIRM":{
      if (body.toLowerCase()==="yes"){
        s.stage="DONE";
        logToSheets({
          from, brand: s.brandKey, brandName: CONFIG[s.brandKey].name, mode: s.mode,
          itemCode: s.itemCode||"", qty: s.qty||"", address: s.address||"",
          dineDate: s.dineDate||"", dineTime: s.dineTime||"", dineGuests: s.dineGuests||"",
          payment: s.payment||"", timestamp: new Date().toISOString()
        });
        const thanks = s.lang==="UR"
          ? `شکریہ! آپ کی درخواست ${CONFIG[s.brandKey].name} کو بھیج دی گئی ہے۔ جلد رابطہ ہوگا۔\n\nنیا آرڈر شروع کرنے کیلئے 'reset' لکھیں۔`
          : `Thanks! Your request has been sent to ${CONFIG[s.brandKey].name}. We'll contact you shortly.\n\nType 'reset' to start a new one.`;
        return twiml(res, thanks);
      }
      return twiml(res, s.lang==="UR"?"براہِ کرم 'yes' لکھ کر تصدیق کریں یا 'back/reset' کریں۔":"Please type 'yes' to confirm, or use 'back/reset'.");
    }
    case "DONE": return twiml(res, s.lang==="UR"?"نیا آرڈر شروع کرنے کیلئے 'reset' لکھیں۔":"Type 'reset' to start a new one.");
    default: s.stage="START"; return twiml(res, "Hi! Choose language:\n1) Urdu\n2) English");
  }
});

app.get("/", (req,res)=> res.type("text/plain").send("WhatsApp Restaurant Demo Bot (Hamza tailored) running."));
app.listen(PORT, ()=> console.log(`Server on ${PORT}`));
