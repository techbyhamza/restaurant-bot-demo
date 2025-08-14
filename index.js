// ===== index.js (FULL, READY-TO-PASTE) =====
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();

// Twilio x-www-form-urlencoded body کے لیے ضروری
app.use(bodyParser.urlencoded({ extended: false }));

// ---------------- Config ----------------
// ---------------- Config ----------------
const CONFIG = {
  alnoor: {
    name: "Al Noor Pizza & Grill",
    delivery: true,
    pickup: true,
    dinein: true,
    paymentOptions: ["COD", "PAY_AT_COUNTER"], // "PAY_ONLINE" بعد میں آسانی سے add ہو جائے گا
    menu: [
      // Pizzas
      { code: "PZ-MARG-S", name: "Margherita (Small)", price: 10 },
      { code: "PZ-MARG-M", name: "Margherita (Medium)", price: 14 },
      { code: "PZ-MARG-L", name: "Margherita (Large)", price: 18 },
      { code: "PZ-BBQ-M",  name: "BBQ Chicken (Medium)", price: 16 },
      { code: "PZ-PEPP-L", name: "Pepperoni (Large)", price: 20 },

      // Burgers & Mains
      { code: "BG-ZING",   name: "Zinger Burger", price: 9 },
      { code: "BG-DBF",    name: "Double Beef Burger", price: 12 },
      { code: "MN-SHAWR",  name: "Chicken Shawarma Plate", price: 13 },

      // Sides
      { code: "SD-FRIES",  name: "Fries (Regular)", price: 4 },
      { code: "SD-GARLIC", name: "Garlic Bread", price: 4 },

      // Drinks
      { code: "DR-COLA",   name: "Cola Can", price: 2.5 },
      { code: "DR-WATER",  name: "Water Bottle", price: 2 },

      // Desserts
      { code: "DS-BROWN",  name: "Chocolate Brownie", price: 4 },
      { code: "DS-ICE",    name: "Ice Cream Cup", price: 4 }
    ],
  },

  firstchoice: {
    name: "First Choice Foods",
    delivery: true,
    pickup: true,
    dinein: true,
    paymentOptions: ["COD", "PAY_AT_COUNTER"],
    menu: [
      // Pakistani/Indian mains
      { code: "IN-BIRY",   name: "Chicken Biryani", price: 10 },
      { code: "IN-BTRCH",  name: "Butter Chicken + Naan", price: 14 },
      { code: "IN-KORMA",  name: "Beef Korma + Naan", price: 15 },
      { code: "IN-DAL",    name: "Dal Tadka + Rice", price: 9 },

      // Burgers & Wraps
      { code: "BG-ZING",   name: "Zinger Burger", price: 9 },
      { code: "WR-CHIC",   name: "Chicken Wrap", price: 8.5 },

      // Sides
      { code: "SD-SALAD",  name: "Green Salad", price: 5 },
      { code: "SD-RAITA",  name: "Raita", price: 2 },

      // Drinks
      { code: "DR-LASSI",  name: "Sweet Lassi", price: 4 },
      { code: "DR-MANGO",  name: "Mango Juice", price: 4.5 },

      // Desserts
      { code: "DS-KHEER",  name: "Kheer", price: 4 },
      { code: "DS-GULAB",  name: "Gulab Jamun (2pc)", price: 4 }
    ],
  },
};

const BRANDS = Object.keys(CONFIG);

// ---------------- Helpers ----------------
const sessions = new Map();

function esc(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function twiml(res, text) {
  res.set("Content-Type", "application/xml");
  return res.send(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${esc(text)}</Message></Response>`
  );
}

function brandList() {
  const lines = BRANDS.map((k, i) => `${i + 1}) ${CONFIG[k].name}`);
  return `Select Restaurant:\n${lines.join("\n")}\n\nSend the number of your choice.\nUse 'back' or 'reset'.`;
}

function orderModes(k) {
  const cfg = CONFIG[k];
  const opts = [];
  if (cfg.delivery) opts.push("1) Delivery");
  if (cfg.pickup)   opts.push("2) Pickup");
  if (cfg.dinein)   opts.push("3) Dine-in (reservation)");
  return `Choose order type:\n${opts.join("\n")}\n\nUse 'back' or 'reset'.`;
}

function menuText(k) {
  const cfg = CONFIG[k];
  const sample = cfg.menu[0]?.code || "P1M";
  const lines = cfg.menu.map((it) => `• ${it.code} — ${it.name} ($${it.price})`);
  return `${cfg.name} — Menu
Send item code (e.g., ${sample})

${lines.join("\n")}

Use 'back' or 'reset'.`;
}

function paymentText(k) {
  const labels = { COD: "Cash on Delivery", PAY_AT_COUNTER: "Pay at Counter", PAY_ONLINE: "Pay Online" };
  const opts = CONFIG[k].paymentOptions || [];
  const lines = opts.map((o, i) => `${i + 1}) ${labels[o] || o}`);
  return `Select payment:\n${lines.join("\n")}\n\nUse 'back' or 'reset'.`;
}

function summary(k, s) {
  const cfg = CONFIG[k];
  const item = cfg.menu.find((i) => i.code === s.itemCode);
  let out = `\n*Summary*\nRestaurant: ${cfg.name}\nType: ${s.mode}\n`;
  if (item) {
    const total = item.price * Number(s.qty || 1);
    out += `Item: ${item.name} x ${s.qty}\n`;
    if (s.mode === "Delivery") out += `Address: ${s.address}\n`;
    out += `Total: $${total}\n`;
  }
  out += `Payment: ${s.payment}`;
  return out;
}

async function logToSheets(payload) {
  const url = process.env.SHEETS_WEBAPP_URL; // Apps Script web app (…/exec)
  if (!url) return; // optional
  try {
    await axios.post(url, payload);
    console.log("[Sheets] OK");
  } catch (err) {
    console.error("[Sheets] ERROR", err?.response?.status, err?.message);
  }
}

// ---------------- WhatsApp Route ----------------
app.post("/whatsapp", async (req, res) => {
  try {
    const from = (req.body?.From || "").toString().trim();
    const body = (req.body?.Body || "").toString().trim();
    console.log("[WA] Incoming:", { from, body });

    // ensure session
    let s = sessions.get(from);
    if (!s) { s = { stage: "START" }; sessions.set(from, s); }

    // reset/back
    if (body.toLowerCase() === "reset") {
      sessions.delete(from);
      return twiml(res, "Hi! Choose language:\n1) Urdu\n2) English\n\nSend the number of your choice.");
    }
    if (body.toLowerCase() === "back") {
      if (s.stage === "MODE") s.stage = "BRAND";
      else if (s.stage === "MENU") s.stage = "MODE";
      else if (s.stage === "QTY") s.stage = "MENU";
      else if (s.stage === "ADDRESS") s.stage = "QTY";
      else if (s.stage === "PAYMENT") s.stage = s.mode === "Delivery" ? "ADDRESS" : "QTY";
      // اگر اور کچھ نہیں تو START پر واپس:
      else s.stage = "START";
    }

    // state machine
    switch (s.stage) {
      case "START": {
        if (body === "1" || body === "2") {
          s.stage = "BRAND";
          return twiml(res, brandList());
        }
        return twiml(res, "Hi! Choose language:\n1) Urdu\n2) English\n\nSend the number of your choice.");
      }

      case "BRAND": {
        const n = parseInt(body, 10);
        if (!n || n < 1 || n > BRANDS.length) return twiml(res, brandList());
        s.brandKey = BRANDS[n - 1];
        s.stage = "MODE";
        return twiml(res, orderModes(s.brandKey));
      }

      case "MODE": {
        if (body === "1") { s.mode = "Delivery"; s.stage = "MENU"; return twiml(res, menuText(s.brandKey)); }
        if (body === "2") { s.mode = "Pickup";   s.stage = "MENU"; return twiml(res, menuText(s.brandKey)); }
        if (body === "3") { s.mode = "Dine-in";  s.stage = "MENU"; return twiml(res, menuText(s.brandKey)); } // سادگی کیلئے dine-in بھی مینو سے شروع
        return twiml(res, orderModes(s.brandKey));
      }

      case "MENU": {
        const code = body.toUpperCase();
        const cfg = CONFIG[s.brandKey];
        const item = cfg.menu.find((m) => m.code === code);
        if (!item) return twiml(res, "Please send a valid item code.\n\n" + menuText(s.brandKey));
        s.itemCode = code;
        s.stage = "QTY";
        return twiml(res, "Send quantity (1–20)");
      }

      case "QTY": {
        const q = parseInt(body, 10);
        if (!q || q < 1 || q > 20) return twiml(res, "Please send a valid quantity (1–20).");
        s.qty = q;
        if (s.mode === "Delivery") { s.stage = "ADDRESS"; return twiml(res, "Enter delivery address:"); }
        s.stage = "PAYMENT";
        return twiml(res, paymentText(s.brandKey));
      }

      case "ADDRESS": {
        if (!body || body.length < 5) return twiml(res, "Please enter a complete address:");
        s.address = body;
        s.stage = "PAYMENT";
        return twiml(res, paymentText(s.brandKey));
      }

      case "PAYMENT": {
        const opts = CONFIG[s.brandKey].paymentOptions || [];
        const idx = parseInt(body, 10) - 1;
        if (idx < 0 || idx >= opts.length) return twiml(res, paymentText(s.brandKey));
        s.payment = opts[idx];
        s.stage = "CONFIRM";
        return twiml(res, "Type 'yes' to confirm, or 'back/reset'.\n" + summary(s.brandKey, s));
      }

      case "CONFIRM": {
        if (body.toLowerCase() === "yes") {
          // Optional: Google Sheets logging
          logToSheets({
            from,
            brandKey: s.brandKey,
            brandName: CONFIG[s.brandKey].name,
            mode: s.mode,
            itemCode: s.itemCode || "",
            qty: s.qty || "",
            address: s.address || "",
            payment: s.payment || "",
            timestamp: new Date().toISOString(),
          });
          sessions.delete(from);
          return twiml(res, "Thanks! Your request has been sent. Type 'hi' to start again.");
        }
        return twiml(res, "Please type 'yes' to confirm, or use 'back/reset'.\n" + summary(s.brandKey, s));
      }

      default: {
        sessions.delete(from);
        return twiml(res, "Hi! Choose language:\n1) Urdu\n2) English");
      }
    }
  } catch (err) {
    console.error("[WA handler error]", err);
    // ایرر میں بھی valid XML دینا لازمی
    return twiml(res, "Temporary error. Please try again.");
  }
});

// ---------------- Health Check ----------------
app.get("/", (_req, res) => res.type("text/plain").send("WhatsApp Restaurant Demo (minimal) running."));

// ---------------- Start Server ----------------
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Server on", PORT));
