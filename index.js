// ====== Imports & Setup ======
const express = require("express");
const axios = require("axios");
const { MessagingResponse } = require("twilio").twiml;

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ====== Google Apps Script Web App URL (آپ کا والا) ======
const SHEETS_WEBAPP_URL =
  "https://script.google.com/macros/s/AKfycbwSFlGupG5znLBi5-zGMo16jEM5wLtZUYyvL-qCANYyjGnDhH_YJbZYWODJrNElb8dX/exec";

// ====== In-memory sessions ======
const sessions = new Map();

// ====== Simple Config ======
const LANG = { UR: "UR", EN: "EN" };
const STAGE = {
  START: "START",
  BRAND: "BRAND",
  MENU: "MENU",
  QTY: "QTY",
  ADDRESS: "ADDRESS",
  PAYMENT: "PAYMENT",
  CONFIRM: "CONFIRM",
};

// دو برانڈز + تھوڑا سا مینو
const CONFIG = {
  alnoor: {
    name: "Al Noor Pizza & Grill",
    items: [
      { code: "P1S", name_en: "Margherita (Small)", price: 10 },
      { code: "P1M", name_en: "Margherita (Medium)", price: 14 },
      { code: "P2M", name_en: "BBQ Chicken (Medium)", price: 16 },
    ],
    paymentOptions: ["Cash on Delivery", "Card on Delivery"],
  },
  firstchoice: {
    name: "First Choice Foods",
    items: [
      { code: "B1K", name_en: "Burger (Single)", price: 8 },
      { code: "B2", name_en: "Double Burger", price: 12 },
      { code: "DS2", name_en: "Ice Cream Cup", price: 4 },
    ],
    paymentOptions: ["Cash on Delivery", "Card on Delivery"],
  },
};

// ====== Helpers ======
function twiml(res, text) {
  const tw = new MessagingResponse();
  tw.message(text);
  res.type("text/xml").send(tw.toString());
}

function brandList() {
  const keys = Object.keys(CONFIG);
  return keys
    .map(
      (k, i) => `${i + 1}) ${CONFIG[k].name}`
    )
    .join("\n");
}

function brandKeyFromChoice(n) {
  const idx = parseInt(n, 10) - 1;
  const keys = Object.keys(CONFIG);
  if (isNaN(idx) || idx < 0 || idx >= keys.length) return null;
  return keys[idx];
}

function menuText(cfg) {
  return (
    `${cfg.name} — Menu\n` +
    `Send item code (e.g., ${cfg.items[0].code})\n\n` +
    cfg.items.map(i => `• ${i.code} — ${i.name_en} ($${i.price})`).join("\n") +
    `\n\nUse 'back' or 'reset'.`
  );
}

function summaryText(cfg, s) {
  if (s.mode === "Delivery") {
    return (
      `Item: ${s.itemCode}\nQty: ${s.qty}\nAddress: ${s.address}\n` +
      `Total: $${(Number(s.price || 0) * Number(s.qty || 1)).toFixed(2)}`
    );
  }
  return `Payment: ${s.payment}`;
}

// Google Sheet پر لکھیں
async function logToSheets(payload) {
  try {
    await axios.post(SHEETS_WEBAPP_URL, payload);
    console.log("[Sheets] OK");
  } catch (err) {
    console.error(
      "[Sheets] ERROR",
      err?.response?.status,
      err?.message
    );
  }
}

// ====== Route ======
app.post("/whatsapp", async (req, res) => {
  const from = (req.body.From || "").trim();
  const body = (req.body.Body || "").trim();

  // reset / back
  if (body.toLowerCase() === "reset") {
    sessions.delete(from);
    return twiml(
      res,
      "Hi! Choose language:\n1) Urdu\n2) English\n\nSend the number of your choice."
    );
  }

  let s = sessions.get(from);
  if (!s) {
    s = { stage: STAGE.START, lang: LANG.EN };
    sessions.set(from, s);
    return twiml(
      res,
      "Hi! Choose language:\n1) Urdu\n2) English\n\nSend the number of your choice."
    );
  }

  // back
  if (body.toLowerCase() === "back") {
    if (s.stage === STAGE.MENU) s.stage = STAGE.BRAND;
    else if (s.stage === STAGE.QTY) s.stage = STAGE.MENU;
    else if (s.stage === STAGE.ADDRESS) s.stage = STAGE.QTY;
    else if (s.stage === STAGE.PAYMENT) s.stage = STAGE.ADDRESS;
    else if (s.stage === STAGE.CONFIRM) s.stage = STAGE.PAYMENT;
  }

  switch (s.stage) {
    case STAGE.START: {
      if (body === "1") s.lang = LANG.UR;
      else if (body === "2") s.lang = LANG.EN;
      s.stage = STAGE.BRAND;
      return twiml(
        res,
        (s.lang === LANG.UR ? "ریسٹورنٹ منتخب کریں:\n" : "Select Restaurant:\n") +
          brandList() +
          "\n\n" +
          (s.lang === LANG.UR
            ? "اپنا انتخاب نمبر بھیجیں۔"
            : "Send the number of your choice.")
      );
    }

    case STAGE.BRAND: {
      const key = brandKeyFromChoice(body);
      if (!key) return twiml(res, "Please send a valid number (1/2).");
      s.brandKey = key;
      s.stage = STAGE.MENU;
      return twiml(res, menuText(CONFIG[s.brandKey]));
    }

    case STAGE.MENU: {
      const cfg = CONFIG[s.brandKey];
      const item = cfg.items.find((i) => i.code.toLowerCase() === body.toLowerCase());
      if (!item) return twiml(res, "Please send a valid item code shown above.");
      s.itemCode = item.code;
      s.itemName = item.name_en;
      s.price = item.price;
      s.stage = STAGE.QTY;
      return twiml(res, "Quantity?");
    }

    case STAGE.QTY: {
      const q = parseInt(body, 10);
      if (!q || q <= 0) return twiml(res, "Please send a valid quantity (e.g., 1, 2).");
      s.qty = q;
      s.stage = STAGE.ADDRESS;
      return twiml(res, "Send delivery address (or type 'Pickup' if you want to pickup).");
    }

    case STAGE.ADDRESS: {
      s.address = body;
      s.stage = STAGE.PAYMENT;
      const opts = CONFIG[s.brandKey].paymentOptions;
      return twiml(
        res,
        "Select payment:\n" + opts.map((o, i) => `${i + 1}) ${o}`).join("\n")
      );
    }

    case STAGE.PAYMENT: {
      const cfg = CONFIG[s.brandKey];
      const idx = parseInt(body, 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= cfg.paymentOptions.length)
        return twiml(res, "Please send a valid option number.");
      s.payment = cfg.paymentOptions[idx];
      s.stage = STAGE.CONFIRM;
      return twiml(
        res,
        "Type 'yes' to confirm, or 'back/reset'.\n\n" + summaryText(cfg, s)
      );
    }

    case STAGE.CONFIRM: {
      if (body.toLowerCase() === "yes") {
        // آرڈر شیٹ کو بھیجیں
        const orderId = `${Date.now()}`.slice(-8);
        await logToSheets({
          orderId,
          customerName: "WhatsApp User",
          phoneNumber: from.replace("whatsapp:", ""),
          orderDetails: `${CONFIG[s.brandKey].name} | ${s.itemCode} x ${s.qty}`,
          quantity: String(s.qty),
          deliveryAddress: s.address || "",
          paymentMethod: s.payment || "",
        });

        sessions.delete(from);
        return twiml(res, "Thanks! Your request has been sent. Type 'hi' to start again.");
      }
      return twiml(res, "Type 'yes' to confirm, or use 'back'/'reset'.");
    }

    default: {
      sessions.delete(from);
      return twiml(
        res,
        "Hi! Choose language:\n1) Urdu\n2) English"
      );
    }
  }
});

// health check
app.get("/", (_req, res) =>
  res.type("text/plain").send("WhatsApp Restaurant Demo (minimal) running.")
);

// start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Server on", PORT));
