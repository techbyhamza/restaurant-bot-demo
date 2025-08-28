// index.js
// WhatsApp Ordering Bot – Mataam Al Arabi + Fuadjian
// Paste this whole file and deploy. Make sure env vars are set as described above.

const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

// ----------------- ENV -----------------
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;              // Meta WhatsApp token
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;        // WhatsApp phone number ID
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "my-secret-123";

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;

const AIRTABLE_BASE_ID_MANDI = process.env.AIRTABLE_BASE_ID_MANDI;
const AIRTABLE_TABLE_ID_MANDI =
  process.env.AIRTABLE_TABLE_ID_MANDI || "Orders_mandi";

const AIRTABLE_BASE_ID_FUADIJAN =
  process.env.AIRTABLE_BASE_ID_FUADIJAN || process.env.AIRTABLE_BASE_ID_FUADIJAN;
const AIRTABLE_TABLE_ID_FUADIJAN =
  process.env.AIRTABLE_TABLE_ID_FUADIJAN || "Orders_Fuadijan";

const ORDER_TZ = process.env.ORDER_TZ || "Australia/Sydney";

// ----------------- IN-MEMORY SESSIONS -----------------
const SESS = new Map(); // key: phone, value: { state, restaurant, customerName, cart:[], category, item, qty, orderType, address }

// helpers
const getSess = (id) => {
  if (!SESS.has(id)) {
    SESS.set(id, { state: "WELCOME", cart: [] });
  }
  return SESS.get(id);
};
const resetSess = (id) => {
  SESS.set(id, { state: "WELCOME", cart: [] });
};

// ----------------- MENUS (with prices) -----------------
/**
 * Restaurant keys: "mandi" (Mataam Al Arabi), "fuadijan" (Fuadjian)
 * Structure: { categories: [ { id, name, emoji, items: [ {id,name,price} ] } ] }
 */

// Mataam Al Arabi (Authentic Mandi & BBQ)
const MENU_MANDI = {
  categories: [
    {
      id: "mandi",
      name: "Mandi",
      emoji: "🍚",
      items: [
        { id: "lamb_mandi_single", name: "Lamb Mandi (Single)", price: 22 },
        { id: "chicken_mandi_single", name: "Chicken Mandi (Single)", price: 20 },
        { id: "mutton_masala_mandi", name: "Mutton Masala Mandi", price: 20 },
        { id: "fish_mandi", name: "Fish Mandi", price: 20 },
        { id: "lamb_ribs_mandi", name: "Lamb Ribs Mandi", price: 30 },
        { id: "mandi_rice", name: "Mandi Rice", price: 10 },
      ],
    },
    {
      id: "deals",
      name: "Mandi Deals",
      emoji: "🧆",
      items: [
        { id: "mix_mandi_deal", name: "Mix Mandi Deal", price: 50 },
        { id: "family_mandi_large", name: "Family Mandi Meal (Large)", price: 120 },
        { id: "special_family_mandi", name: "Special Family Mandi Deal", price: 175 },
      ],
    },
    {
      id: "whole_lamb",
      name: "Whole Lamb Mandi",
      emoji: "🍖",
      items: [
        { id: "whole_lamb_takeaway", name: "Whole Lamb for 20 (Take-away)", price: 600 },
        { id: "whole_lamb_dinein", name: "Whole Lamb for 20 (Dine-in)", price: 650 },
      ],
    },
    {
      id: "curries",
      name: "Curries",
      emoji: "🍲",
      items: [
        { id: "mughlai_mutton", name: "Mughlai Mutton", price: 20 },
        { id: "dum_ka_chicken", name: "Dum ka Chicken", price: 20 },
        { id: "lamb_marag", name: "Lamb Marag Soup", price: 20 },
        { id: "chicken_kadai", name: "Chicken Kadai", price: 20 },
        { id: "butter_chicken", name: "Butter Chicken", price: 20 },
      ],
    },
    {
      id: "breads",
      name: "Bread (Naan)",
      emoji: "🥖",
      items: [
        { id: "plain_naan", name: "Plain Naan", price: 2.5 },
        { id: "butter_naan", name: "Butter Naan", price: 3 },
        { id: "cheese_naan", name: "Cheese Naan", price: 4 },
        { id: "garlic_naan", name: "Garlic Naan", price: 4 },
        { id: "cheese_garlic_naan", name: "Cheese Garlic Naan", price: 4.5 },
      ],
    },
    {
      id: "desserts_drinks",
      name: "Desserts & Drinks",
      emoji: "🍮",
      items: [
        { id: "fruit_custard", name: "Fruit Custard", price: 8 },
        { id: "gulab_jamun", name: "Gulab Jamun", price: 8 },
        { id: "sitafal_cream", name: "Sitafal Cream", price: 8 },
        { id: "mango_malai", name: "Mango Malai", price: 8 },
        { id: "soft_drink", name: "Soft Drink (Can)", price: 3 },
        { id: "mango_lassi", name: "Mango Lassi", price: 7 },
        { id: "kulfi", name: "Kulfi", price: 6 },
      ],
    },
  ],
};

// Fuadjian – Best Pakistani Street Food
const MENU_FUADIJAN = {
  categories: [
    {
      id: "burgers_wraps",
      name: "Burgers & Wraps",
      emoji: "🍔",
      items: [
        { id: "beef_burger", name: "Beef Burger", price: 14 },
        { id: "chicken_tikka_burger", name: "Chicken Tikka Burger", price: 13 },
        { id: "zinger_burger", name: "Zinger Burger", price: 13 },
        { id: "chicken_shami_burger", name: "Chicken Shami Burger", price: 11 },
        { id: "veggie_wrap", name: "Veggie Wrap", price: 13 },
      ],
    },
    {
      id: "karahi_nihari",
      name: "Karahi & Nihari",
      emoji: "🍛",
      items: [
        { id: "chicken_karahi_half", name: "Chicken Karahi (Half)", price: 24 },
        { id: "beef_nihari_plate", name: "Beef Nihari Plate", price: 15 },
      ],
    },
    {
      id: "plates_bbq",
      name: "BBQ & Plates",
      emoji: "🍢",
      items: [
        { id: "chicken_tikka_plate", name: "Chicken Tikka Plate", price: 18 },
        { id: "beef_seekh_plate", name: "Beef Seekh Plate", price: 18 },
        { id: "beef_chapli_plate", name: "Beef Chapli Kebab Plate", price: 18 },
        { id: "lamb_chops_3", name: "Lamb Chops — 3 pieces", price: 20 },
      ],
    },
    {
      id: "sweets_drinks",
      name: "Sweets & Drinks",
      emoji: "🥤",
      items: [
        { id: "gulab_jamun_pc", name: "Gulab Jamun (1 pc)", price: 2 },
        { id: "kheer_200g", name: "Kheer (200 gms)", price: 6 },
        { id: "soft_drink_125", name: "1.25L Soft Drink", price: 6 },
        { id: "milkshake_mango", name: "Mango Milkshake", price: 9 },
        { id: "juice_bottle", name: "Juice Bottle", price: 5 },
        { id: "water_bottle", name: "Water Bottle", price: 3 },
      ],
    },
  ],
};

// quick indexers
const R_MENUS = {
  mandi: MENU_MANDI,
  fuadijan: MENU_FUADIJAN,
};

// ----------------- TIMEZONE ISO -----------------
function zonedNowISO(tz = ORDER_TZ) {
  const now = new Date();
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(now).map(p => [p.type, p.value]));
  const y = Number(parts.year);
  const m = Number(parts.month);
  const d = Number(parts.day);
  const H = Number(parts.hour);
  const M = Number(parts.minute);
  const S = Number(parts.second);
  const utcLike = Date.UTC(y, m - 1, d, H, M, S);
  const offsetMin = Math.round((utcLike - now.getTime()) / 60000);
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const offHH = String(Math.floor(abs / 60)).padStart(2, "0");
  const offMM = String(abs % 60).padStart(2, "0");
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${sign}${offHH}:${offMM}`;
}

// ----------------- WHATSAPP SEND -----------------
async function send(to, text) {
  const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  };
  await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  });
}

// ----------------- UI BUILDERS -----------------
const NL = "\n";
const SP = " "; // keep tight spacing

function welcomeMsg() {
  return (
    "👋 Welcome to our Online Ordering System!" + NL +
    NL +
    "Select your restaurant:" + NL +
    "1️⃣ Mataam Al Arabi 🍖 — Authentic Mandi & BBQ Restaurant" + NL +
    NL + // small professional gap
    "2️⃣ Fuadjian 🌶️ — Best Pakistani Street Food" + NL +
    NL +
    "Type the number. Send 'menu' anytime to restart, or 'reset' to clear."
  );
}

function categoriesMsg(restaurantKey) {
  const restTitle =
    restaurantKey === "mandi"
      ? "Mataam Al Arabi"
      : "Fuadjian";
  const cats = R_MENUS[restaurantKey].categories;

  let lines = [];
  lines.push(`📋 ${restTitle} — Categories`);
  lines.push(""); // one small gap

  cats.forEach((c, i) => {
    lines.push(`${boxNum(i + 1)} ${c.emoji} ${c.name}`);
  });

  lines.push("");
  lines.push("Type the number to choose a category.");
  return lines.join(NL);
}

function itemsMsg(restaurantKey, categoryIndex) {
  const cat = R_MENUS[restaurantKey].categories[categoryIndex];
  let lines = [];
  lines.push(`${cat.emoji} ${cat.name}`);
  lines.push("");
  cat.items.forEach((it, i) => {
    lines.push(`${boxNum(i + 1)} ${it.name} (A$${it.price})`);
  });
  lines.push("");
  lines.push("Type the number to choose an item.");
  return lines.join(NL);
}

function askQtyMsg(itemName, price) {
  return (
    `How many for “${itemName}” (A$${price})?` + NL +
    "Reply with a number, e.g. 1 or 2."
  );
}

function addMoreMsg() {
  return (
    "Would you like to add another item?" + NL +
    `${boxNum(1)} Yes   ${boxNum(2)} No`
  );
}

function orderTypeMsg() {
  return (
    "Choose order type:" + NL +
    `${boxNum(1)} Delivery 🚚` + NL +
    `${boxNum(2)} Takeaway 🛍️` + NL +
    `${boxNum(3)} Dine-in 🍽️`
  );
}

function confirmationMsg(sess) {
  const lines = [];
  const prettyItems = sess.cart
    .map(it => `${it.emoji} ${it.name} × ${it.qty}`)
    .join(NL);

  const total = sess.cart.reduce((sum, i) => sum + i.qty * i.price, 0);

  lines.push(`Restaurant: ${sess.restaurant === "mandi" ? "Mataam Al Arabi" : "Fuadjian — Pakistani Street Food"}`);
  lines.push(`Name: ${sess.customerName}`);
  lines.push(`Order Type: ${sess.orderType}`);
  if (sess.orderType === "Delivery") lines.push(`Address: ${sess.address}`);
  lines.push("");
  lines.push(prettyItems);
  lines.push(``);
  lines.push(`Qty: ${sess.cart.reduce((n, i) => n + i.qty, 0)}`);
  lines.push(`Total: A$${total.toFixed(2)}`);
  lines.push("");
  lines.push("✅ Confirm → type *yes*");
  lines.push("❌ Cancel → type *no*");
  return lines.join(NL);
}

function orderConfirmedMsg(sess) {
  const total = sess.cart.reduce((sum, i) => sum + i.qty * i.price, 0);
  const firstLine =
    sess.cart.length === 1
      ? `${sess.cart[0].emoji} ${sess.cart[0].name} × ${sess.cart[0].qty}`
      : sess.cart.map(i => `${i.emoji} ${i.name} × ${i.qty}`).join(NL);

  return (
    "🎉 Order confirmed!" + NL +
    firstLine + NL +
    `Total: A$${total.toFixed(2)}` + NL +
    NL +
    "Type *menu* to order again or *restart* to switch restaurant."
  );
}

function boxNum(n) {
  const map = { 1: "1️⃣", 2: "2️⃣", 3: "3️⃣", 4: "4️⃣", 5: "5️⃣", 6: "6️⃣", 7: "7️⃣", 8: "8️⃣", 9: "9️⃣" };
  return map[n] || `${n}️⃣`;
}

// ----------------- CART / AIRTABLE HELPERS -----------------
function addItemToCart(sess, restaurantKey, categoryIndex, itemIndex, qty) {
  const cat = R_MENUS[restaurantKey].categories[categoryIndex];
  const it = cat.items[itemIndex];
  sess.cart.push({
    id: it.id,
    name: it.name,
    price: it.price,
    qty,
    emoji: R_MENUS[restaurantKey].categories[categoryIndex].emoji,
  });
}

function buildOrderItemsText(cart) {
  return cart.map(i => `${i.name} (A$${i.price}) × ${i.qty}`).join(" • ");
}
function sumQuantity(cart) {
  return cart.reduce((n, i) => n + Number(i.qty || 0), 0);
}

async function saveToAirtable(sess, from) {
  const restaurantKey = sess.restaurant; // "mandi" | "fuadijan"
  const baseId =
    restaurantKey === "mandi" ? AIRTABLE_BASE_ID_MANDI : AIRTABLE_BASE_ID_FUADIJAN;
  const tableIdOrName =
    restaurantKey === "mandi" ? AIRTABLE_TABLE_ID_MANDI : AIRTABLE_TABLE_ID_FUADIJAN;

  const orderItemsText = buildOrderItemsText(sess.cart);
  const totalQty = sumQuantity(sess.cart);
  const orderTimeISO = zonedNowISO();

  let fields;
  if (restaurantKey === "mandi") {
    fields = {
      "Phone Number": from,
      "Customer Name": sess.customerName,
      "Order Item": orderItemsText,
      "Quantity": totalQty,
      "Address": sess.orderType === "Delivery" ? (sess.address || "") : (sess.orderType || ""),
      "Status": "Pending",
      "Order Type": sess.orderType,
      "Order Time": orderTimeISO,
    };
  } else {
    fields = {
      "PhoneNumber": from,
      "CustomerName": sess.customerName,
      "MenuItem": orderItemsText,
      "Quantity": totalQty,
      "Address": sess.orderType === "Delivery" ? (sess.address || "") : (sess.orderType || ""),
      "OrderType": sess.orderType,
      "OrderTime": orderTimeISO,
    };
  }

  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableIdOrName)}`;
  const payload = { records: [{ fields }] };

  const res = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
  });
  return res.data;
}

// ----------------- WEBHOOK (VERIFY) -----------------
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ----------------- WEBHOOK (MESSAGES) -----------------
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];
    if (!message) return res.sendStatus(200);

    const from = message.from; // phone number (string)
    const text = (message.text?.body || "").trim();
    const sess = getSess(from);

    // global commands
    if (/^(menu|restart)$/i.test(text)) {
      resetSess(from);
      await send(from, welcomeMsg());
      return res.sendStatus(200);
    }
    if (/^reset$/i.test(text)) {
      resetSess(from);
      await send(from, "Session cleared. " + NL + NL + welcomeMsg());
      return res.sendStatus(200);
    }
    if (/^(hi|hello|hey)$/i.test(text) && sess.state === "WELCOME") {
      await send(from, welcomeMsg());
      sess.state = "CHOOSE_RESTAURANT";
      return res.sendStatus(200);
    }

    // state machine
    switch (sess.state) {
      case "WELCOME": {
        await send(from, welcomeMsg());
        sess.state = "CHOOSE_RESTAURANT";
        break;
      }

      case "CHOOSE_RESTAURANT": {
        if (text === "1" || /arabi/i.test(text)) {
          sess.restaurant = "mandi";
        } else if (text === "2" || /fuad/i.test(text)) {
          sess.restaurant = "fuadijan";
        } else {
          await send(from, "Please type 1 or 2 to select a restaurant." + NL + NL + welcomeMsg());
          break;
        }
        sess.state = "ASK_NAME";
        await send(from, "Please share your name:");
        break;
      }

      case "ASK_NAME": {
        if (!text) {
          await send(from, "Please type your name:");
          break;
        }
        sess.customerName = text;
        sess.state = "CHOOSE_CATEGORY";
        await send(from, categoriesMsg(sess.restaurant));
        break;
      }

      case "CHOOSE_CATEGORY": {
        const cats = R_MENUS[sess.restaurant].categories;
        const idx = parseInt(text, 10) - 1;
        if (isNaN(idx) || idx < 0 || idx >= cats.length) {
          await send(from, "Please type a valid category number." + NL + NL + categoriesMsg(sess.restaurant));
          break;
        }
        sess.categoryIndex = idx;
        sess.state = "CHOOSE_ITEM";
        await send(from, itemsMsg(sess.restaurant, idx));
        break;
      }

      case "CHOOSE_ITEM": {
        const items = R_MENUS[sess.restaurant].categories[sess.categoryIndex].items;
        const idx = parseInt(text, 10) - 1;
        if (isNaN(idx) || idx < 0 || idx >= items.length) {
          await send(from, "Please type a valid item number." + NL + NL + itemsMsg(sess.restaurant, sess.categoryIndex));
          break;
        }
        sess.itemIndex = idx;
        const it = items[idx];
        sess.state = "ASK_QTY";
        await send(from, askQtyMsg(it.name, it.price));
        break;
      }

      case "ASK_QTY": {
        const qty = parseInt(text, 10);
        if (isNaN(qty) || qty <= 0) {
          await send(from, "Please reply with a valid quantity, e.g. 1 or 2.");
          break;
        }
        addItemToCart(sess, sess.restaurant, sess.categoryIndex, sess.itemIndex, qty);
        sess.state = "ADD_MORE";
        await send(from, addMoreMsg());
        break;
      }

      case "ADD_MORE": {
        if (text === "1" || /^y(es)?$/i.test(text)) {
          sess.state = "CHOOSE_CATEGORY";
          await send(from, categoriesMsg(sess.restaurant));
        } else if (text === "2" || /^no?$/i.test(text)) {
          sess.state = "CHOOSE_ORDER_TYPE";
          await send(from, orderTypeMsg());
        } else {
          await send(from, "Please choose an option." + NL + addMoreMsg());
        }
        break;
      }

      case "CHOOSE_ORDER_TYPE": {
        if (text === "1" || /^del/i.test(text)) {
          sess.orderType = "Delivery";
          sess.state = "ASK_ADDRESS";
          await send(from, "Please enter your delivery address:");
        } else if (text === "2" || /^take/i.test(text)) {
          sess.orderType = "Takeaway";
          sess.address = ""; // not required
          sess.state = "CONFIRM";
          await send(from, confirmationMsg(sess));
        } else if (text === "3" || /^dine/i.test(text)) {
          sess.orderType = "Dine-in";
          sess.address = ""; // optional
          sess.state = "CONFIRM";
          await send(from, confirmationMsg(sess));
        } else {
          await send(from, "Please type 1, 2 or 3." + NL + NL + orderTypeMsg());
        }
        break;
      }

      case "ASK_ADDRESS": {
        if (!text) {
          await send(from, "Please type a valid address:");
          break;
        }
        sess.address = text;
        sess.state = "CONFIRM";
        await send(from, confirmationMsg(sess));
        break;
      }

      case "CONFIRM": {
        if (/^yes$/i.test(text)) {
          // Save one row per order
          try {
            await saveToAirtable(sess, from);
            await send(from, orderConfirmedMsg(sess));
          } catch (e) {
            console.error("Airtable save error:", e?.response?.data || e.message);
            await send(from, "⚠️ Error saving to Airtable. Please try again later.");
          }
          resetSess(from);
        } else if (/^no?$/i.test(text)) {
          await send(from, "Order cancelled. Type *menu* to start again.");
          resetSess(from);
        } else {
          await send(from, "Please type *yes* to confirm or *no* to cancel." + NL + NL + confirmationMsg(sess));
        }
        break;
      }

      default: {
        resetSess(from);
        await send(from, welcomeMsg());
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err.message, err?.response?.data);
    res.sendStatus(200);
  }
});

// Health
app.get("/", (_req, res) => res.send("OK"));
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
