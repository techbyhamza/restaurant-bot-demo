// index.js  (Node 18+, package.json: { "type": "module" })
import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// ----- Env -----
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;           // Meta permanent token
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;     // WABA phone number id
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;           // Webhook verify token

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;

// ----- In‑memory sessions -----
/** sessions[from] = {
 *   step: 'main' | 'pizzaCat' | 'pizzaItem' | 'pizzaSize' | 'qty' | 'orderType' | 'address' | 'summary'
 *   cart: [{ name, price, qty }]
 *   current: { itemName?, size?, unitPrice? }
 *   orderType: 'Delivery' | 'Takeaway' | 'Dine-in'
 *   address?: string
 * }
 */
const sessions = {};

// ----- Menu Data (English only) -----
const PIZZA_SIZES = ["Small", "Medium", "Large"];

const PIZZAS = [
  // Classic
  { code: "1", name: "Margherita", prices: { Small: 8.99, Medium: 12.99, Large: 15.99 } },
  { code: "2", name: "Pepperoni", prices: { Small: 9.99, Medium: 13.99, Large: 16.99 } },
  { code: "3", name: "Chicken Tikka", prices: { Small: 10.99, Medium: 14.99, Large: 17.99 } },
  // Specialty
  { code: "4", name: "BBQ Chicken", prices: { Small: 11.99, Medium: 15.99, Large: 18.99 } },
  { code: "5", name: "Supreme Pizza", prices: { Small: 12.99, Medium: 16.99, Large: 19.99 } },
  { code: "6", name: "Veggie Lovers", prices: { Small: 9.99, Medium: 13.99, Large: 16.99 } },
];

const SIDES = [
  { code: "1", name: "Garlic Bread", price: 4.99 },
  { code: "2", name: "Cheesy Bread Sticks", price: 5.99 },
  { code: "3", name: "Chicken Wings (6 pcs)", price: 7.99 },
  { code: "4", name: "Fries", price: 3.99 },
];

const DRINKS = [
  { code: "1", name: "Coke", price: 2.5 },
  { code: "2", name: "Sprite", price: 2.5 },
  { code: "3", name: "Water Bottle", price: 1.5 },
  { code: "4", name: "Juice", price: 3.0 },
];

const DEALS = [
  { code: "1", name: "Family Deal – 2 Large Pizzas + 1 Side + 1.5L Drink", price: 39.99 },
  { code: "2", name: "Student Deal – 1 Medium Pizza + Fries + Drink", price: 15.99 },
  { code: "3", name: "Couple Deal – 1 Large Pizza + 2 Drinks", price: 21.99 },
];

const ORDER_TYPES = ["Delivery", "Takeaway", "Dine-in"];

// ----- Helpers -----
function startSession(from) {
  sessions[from] = {
    step: "main",
    cart: [],
    current: {},
    orderType: null,
    address: null
  };
}

function money(n) {
  return `$${n.toFixed(2)}`;
}

function sumCart(cart) {
  return cart.reduce((a, i) => a + i.price * i.qty, 0);
}

function mainMenuText() {
  return [
    "📋 *Please select a category:*",
    "1️⃣ Pizzas",
    "2️⃣ Sides & Snacks",
    "3️⃣ Drinks",
    "4️⃣ Deals & Combos",
    "5️⃣ Contact & Location",
    "",
    "Type the number (e.g., 1). Type *menu* to restart."
  ].join("\n");
}

function pizzasText() {
  const lines = PIZZAS.map(p => `*${p.code}*. ${p.name}`);
  return ["🍕 *Pizzas* (choose item number):", ...lines].join("\n");
}

function pizzaSizesText(pizza) {
  return [
    `Choose size for *${pizza.name}*:`,
    `• Small — ${money(pizza.prices.Small)}`,
    `• Medium — ${money(pizza.prices.Medium)}`,
    `• Large — ${money(pizza.prices.Large)}`
  ].join("\n");
}

function sidesText() {
  return ["🍟 *Sides & Snacks* (type number):", ...SIDES.map(s => `*${s.code}*. ${s.name} — ${money(s.price)}`)].join("\n");
}

function drinksText() {
  return ["🥤 *Drinks* (type number):", ...DRINKS.map(d => `*${d.code}*. ${d.name} — ${money(d.price)}`)].join("\n");
}

function dealsText() {
  return ["💥 *Deals & Combos* (type number):", ...DEALS.map(d => `*${d.code}*. ${d.name} — ${money(d.price)}`)].join("\n");
}

function cartText(cart) {
  if (!cart.length) return "Your cart is empty.";
  const lines = cart.map((it, i) => `${i + 1}. ${it.name} x${it.qty} — ${money(it.price * it.qty)}`);
  return ["🛒 *Your Cart*", ...lines, "", `Subtotal: *${money(sumCart(cart))}*`].join("\n");
}

function orderTypeText() {
  return [
    "Choose *Order Type*:",
    "• Delivery",
    "• Takeaway",
    "• Dine-in"
  ].join("\n");
}

function summaryText(s) {
  const lines = s.cart.map((it, i) => `${i + 1}. ${it.name} x${it.qty} — ${money(it.price * it.qty)}`);
  return [
    "🧾 *Order Summary* ✅",
    ...lines,
    "",
    `Subtotal: *${money(sumCart(s.cart))}*`,
    `Order Type: *${s.orderType}*`,
    ...(s.orderType === "Delivery" && s.address ? [`Address: *${s.address}*`] : []),
    "",
    "Type *confirm* to place the order, or *menu* to restart."
  ].join("\n");
}

async function sendMessage(to, text) {
  const url = `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text }
  };
  await axios.post(url, body, {
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    }
  });
}

async function saveToAirtable(record) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`;
  const fields = {
    "Phone Number": record.phone,
    "Order Item": record.itemName,     // you will see joined text of cart
    "Quantity": record.totalQty,       // total quantity across items
    "Address": record.address || "",
    "Status": "Pending",
    "Order Time": new Date().toISOString(),
    "Order Type": record.orderType
  };

  await axios.post(
    url,
    { records: [{ fields }] },
    {
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );
}

// ----- Webhook Verify -----
app.get("/webhook", (req, res) => {
  try {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  } catch {
    return res.sendStatus(500);
  }
});

// ----- Webhook Receive -----
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const msg = value?.messages?.[0];
    const from = msg?.from;
    if (!from) return res.sendStatus(200);

    let body = "";
    if (msg.type === "text") body = msg.text?.body || "";
    else if (msg.type === "interactive") {
      const t = msg.interactive?.type;
      body = t === "button_reply"
        ? msg.interactive?.button_reply?.title || ""
        : t === "list_reply"
        ? msg.interactive?.list_reply?.title || ""
        : "";
    }
    body = (body || "").trim();
    const lc = body.toLowerCase();

    // Restart
    if (["menu", "start", "restart", "7"].includes(lc)) {
      startSession(from);
      await sendMessage(from, "👋 Welcome to *Al Noor Pizza*!\n" + mainMenuText());
      return res.sendStatus(200);
    }

    // First time / greetings
    if (!sessions[from] || ["hi", "hello", "hey"].includes(lc)) {
      startSession(from);
      await sendMessage(from, "👋 Welcome to *Al Noor Pizza*!\n" + mainMenuText());
      return res.sendStatus(200);
    }

    const s = sessions[from];

    // MAIN MENU
    if (s.step === "main") {
      if (["1", "pizzas", "pizza"].includes(lc)) {
        s.step = "pizzaItem";
        await sendMessage(from, pizzasText());
        return res.sendStatus(200);
      }
      if (["2", "sides", "snacks"].includes(lc)) {
        s.step = "sides";
        await sendMessage(from, sidesText() + "\n\nType the number to add, or *back*.");
        return res.sendStatus(200);
      }
      if (["3", "drinks"].includes(lc)) {
        s.step = "drinks";
        await sendMessage(from, drinksText() + "\n\nType the number to add, or *back*.");
        return res.sendStatus(200);
      }
      if (["4", "deals", "combos"].includes(lc)) {
        s.step = "deals";
        await sendMessage(from, dealsText() + "\n\nType the number to add, or *back*.");
        return res.sendStatus(200);
      }
      if (["5", "contact", "location"].includes(lc)) {
        await sendMessage(
          from,
          "📍 *Al Noor Pizza*\n123 High Street, Sydney\nPhone: 02 1234 5678\nHours: 11:00–23:00"
        );
        return res.sendStatus(200);
      }
      await sendMessage(from, "Please choose 1–5.\n\n" + mainMenuText());
      return res.sendStatus(200);
    }

    // PIZZA ITEM
    if (s.step === "pizzaItem") {
      const choice = PIZZAS.find(p => p.code === lc || p.name.toLowerCase() === lc);
      if (!choice) {
        await sendMessage(from, "Please pick a pizza number.\n\n" + pizzasText());
        return res.sendStatus(200);
      }
      s.current = { itemName: choice.name, prices: choice.prices };
      s.step = "pizzaSize";
      await sendMessage(from, pizzaSizesText(choice));
      return res.sendStatus(200);
    }

    // PIZZA SIZE
    if (s.step === "pizzaSize") {
      let sizeMatch = PIZZA_SIZES.find(sz => sz.toLowerCase() === lc);
      if (!sizeMatch) {
        // allow s/m/l shorthand
        if (["s", "m", "l"].includes(lc)) sizeMatch = ({ s: "Small", m: "Medium", l: "Large" })[lc];
      }
      if (!sizeMatch) {
        await sendMessage(from, "Please type Small, Medium, or Large.");
        return res.sendStatus(200);
      }
      const price = s.current.prices[sizeMatch];
      s.current.size = sizeMatch;
      s.current.unitPrice = price;
      s.step = "qty";
      await sendMessage(from, `How many *${sizeMatch} ${s.current.itemName}*? (e.g., 1 or 2)`);
      return res.sendStatus(200);
    }

    // QUANTITY
    if (s.step === "qty") {
      const n = parseInt(lc, 10);
      if (!Number.isFinite(n) || n <= 0) {
        await sendMessage(from, "Please enter a valid quantity (e.g., 1 or 2).");
        return res.sendStatus(200);
      }
      s.cart.push({
        name: `${s.current.size} ${s.current.itemName}`,
        price: s.current.unitPrice,
        qty: n
      });
      s.current = {};
      // After adding pizza, go to order type
      s.step = "orderType";
      await sendMessage(from, cartText(s.cart) + "\n\n" + orderTypeText());
      return res.sendStatus(200);
    }

    // SIDES
    if (s.step === "sides") {
      if (lc === "back") {
        s.step = "main";
        await sendMessage(from, mainMenuText());
        return res.sendStatus(200);
      }
      const side = SIDES.find(x => x.code === lc || x.name.toLowerCase() === lc);
      if (!side) {
        await sendMessage(from, "Please pick a side number, or type *back*.\n\n" + sidesText());
        return res.sendStatus(200);
      }
      s.cart.push({ name: side.name, price: side.price, qty: 1 });
      s.step = "orderType";
      await sendMessage(from, cartText(s.cart) + "\n\n" + orderTypeText());
      return res.sendStatus(200);
    }

    // DRINKS
    if (s.step === "drinks") {
      if (lc === "back") {
        s.step = "main";
        await sendMessage(from, mainMenuText());
        return res.sendStatus(200);
      }
      const drink = DRINKS.find(x => x.code === lc || x.name.toLowerCase() === lc);
      if (!drink) {
        await sendMessage(from, "Please pick a drink number, or type *back*.\n\n" + drinksText());
        return res.sendStatus(200);
      }
      s.cart.push({ name: drink.name, price: drink.price, qty: 1 });
      s.step = "orderType";
      await sendMessage(from, cartText(s.cart) + "\n\n" + orderTypeText());
      return res.sendStatus(200);
    }

    // DEALS
    if (s.step === "deals") {
      if (lc === "back") {
        s.step = "main";
        await sendMessage(from, mainMenuText());
        return res.sendStatus(200);
      }
      const deal = DEALS.find(x => x.code === lc || x.name.toLowerCase() === lc);
      if (!deal) {
        await sendMessage(from, "Please pick a deal number, or type *back*.\n\n" + dealsText());
        return res.sendStatus(200);
      }
      s.cart.push({ name: deal.name, price: deal.price, qty: 1 });
      s.step = "orderType";
      await sendMessage(from, cartText(s.cart) + "\n\n" + orderTypeText());
      return res.sendStatus(200);
    }

    // ORDER TYPE
    if (s.step === "orderType") {
      const match = ORDER_TYPES.find(t => t.toLowerCase() === lc);
      if (!match) {
        await sendMessage(from, "Please type *Delivery*, *Takeaway*, or *Dine-in*.");
        return res.sendStatus(200);
      }
      s.orderType = match;

      if (s.orderType === "Delivery") {
        s.step = "address";
        await sendMessage(from, "Please send your *delivery address*.");
        return res.sendStatus(200);
      } else {
        s.step = "summary";
        await sendMessage(from, summaryText(s));
        return res.sendStatus(200);
      }
    }

    // ADDRESS (for Delivery)
    if (s.step === "address") {
      if (!body) {
        await sendMessage(from, "Please enter a valid address.");
        return res.sendStatus(200);
      }
      s.address = body;
      s.step = "summary";
      await sendMessage(from, summaryText(s));
      return res.sendStatus(200);
    }

    // SUMMARY / CONFIRM
    if (s.step === "summary") {
      if (lc === "confirm") {
        try {
          const itemNames = s.cart.map(i => `${i.name} x${i.qty}`).join(", ");
          const totalQty = s.cart.reduce((a, i) => a + i.qty, 0);
          await saveToAirtable({
            phone: `+${from}`,
            itemName: itemNames,
            totalQty,
            orderType: s.orderType,
            address: s.address || ""
          });
          sessions[from] = null;
          await sendMessage(from, "🎉 *Your order has been placed successfully!*\nThank you! Type *menu* to order again.");
        } catch (err) {
          console.error("Airtable save error:", err?.response?.data || err.message);
          await sendMessage(from, "⚠️ Sorry, we couldn’t save your order right now. Please try again.");
        }
        return res.sendStatus(200);
      }
      await sendMessage(from, "Type *confirm* to place the order, or *menu* to restart.");
      return res.sendStatus(200);
    }

    // Fallback
    await sendMessage(from, "Type *menu* to see options.");
    return res.sendStatus(200);
  } catch (e) {
    console.error("Webhook error:", e?.response?.data || e.message);
    return res.sendStatus(200);
  }
});

// ----- Health -----
app.get("/health", (req, res) => res.status(200).send("ok"));

// ----- Start -----
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Server listening on", PORT));
