// index.js — Al Noor Pizza • WhatsApp Cloud API • English-only
// Requires: "express", "axios" (package.json -> dependencies)
// ENV: ACCESS_TOKEN, VERIFY_TOKEN, PHONE_NUMBER_ID, AIRTABLE_API_KEY, AIRTABLE_BASE_ID, AIRTABLE_TABLE_NAME

import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// ======== ENV ========
const ACCESS_TOKEN       = process.env.ACCESS_TOKEN;
const VERIFY_TOKEN       = process.env.VERIFY_TOKEN;
const PHONE_NUMBER_ID    = process.env.PHONE_NUMBER_ID;
const AIRTABLE_API_KEY   = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID   = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE     = process.env.AIRTABLE_TABLE_NAME || "Orders";

// ======== MENU (Al Noor Pizza) ========
const MENU = {
  categories: [
    { code: "1", name: "Pizzas" },
    { code: "2", name: "Sides & Snacks" },
    { code: "3", name: "Drinks" },
    { code: "4", name: "Deals & Combos" },
  ],
  pizzas: [
    // id must be unique across pizzas
    { id: "P1", name: "Margherita", prices: { S: 8.99, M: 12.99, L: 15.99 } },
    { id: "P2", name: "Pepperoni", prices: { S: 9.99, M: 13.99, L: 16.99 } },
    { id: "P3", name: "Chicken Tikka", prices: { S: 10.99, M: 14.99, L: 17.99 } },
    { id: "P4", name: "BBQ Chicken", prices: { S: 11.99, M: 15.99, L: 18.99 } },
    { id: "P5", name: "Supreme", prices: { S: 12.99, M: 16.99, L: 19.99 } },
    { id: "P6", name: "Veggie Lovers", prices: { S: 9.99, M: 13.99, L: 16.99 } },
  ],
  sides: [
    { id: "S1", name: "Garlic Bread", price: 4.99 },
    { id: "S2", name: "Cheesy Bread Sticks", price: 5.99 },
    { id: "S3", name: "Chicken Wings (6 pcs)", price: 7.99 },
    { id: "S4", name: "Fries", price: 3.99 },
  ],
  drinks: [
    { id: "D1", name: "Coke", price: 2.5 },
    { id: "D2", name: "Sprite", price: 2.5 },
    { id: "D3", name: "Water Bottle", price: 1.5 },
    { id: "D4", name: "Juice", price: 3.0 },
  ],
  deals: [
    { id: "DL1", name: "Family Deal (2 Large Pizzas + 1 Side + 1.5L Drink)", price: 39.99 },
    { id: "DL2", name: "Student Deal (1 Medium Pizza + Fries + Drink)", price: 15.99 },
    { id: "DL3", name: "Couple Deal (1 Large Pizza + 2 Drinks)", price: 21.99 },
  ],
};

// ======== IN-MEMORY SESSIONS ========
// sessions[waNumber] = { step, cart:[], temp:{}, orderType, address }
const sessions = Object.create(null);

// ======== HELPERS ========
const sendText = async (to, text) => {
  const url = `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`;
  await axios.post(
    url,
    { messaging_product: "whatsapp", to, type: "text", text: { body: text } },
    { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
  );
};

const money = (n) => `$${n.toFixed(2)}`;

const welcomeText = () =>
  [
    "👋 Welcome to *Al Noor Pizza*!",
    "",
    "Type *menu* to browse categories.",
    "Type *cart* to view your cart, *checkout* to finish, or *restart* to start again.",
  ].join("\n");

const renderCategories = () =>
  [
    "📋 *Main Menu*",
    "1. Pizzas",
    "2. Sides & Snacks",
    "3. Drinks",
    "4. Deals & Combos",
    "",
    "Reply with a number (e.g. *1*)",
    "Commands: *cart*, *checkout*, *restart*, *help*",
  ].join("\n");

const renderPizzas = () => {
  const lines = MENU.pizzas.map(
    (p, i) =>
      `${i + 1}. ${p.name} — S ${money(p.prices.S)} | M ${money(p.prices.M)} | L ${money(p.prices.L)}`
  );
  return ["🍕 *Pizzas*", ...lines, "", "Reply with the *pizza number* (e.g. *1*)"].join("\n");
};

const renderSides = () => {
  const lines = MENU.sides.map((s, i) => `${i + 1}. ${s.name} — ${money(s.price)}`);
  return ["🍟 *Sides & Snacks*", ...lines, "", "Reply with the *side number* (e.g. *1*)"].join("\n");
};

const renderDrinks = () => {
  const lines = MENU.drinks.map((d, i) => `${i + 1}. ${d.name} — ${money(d.price)}`);
  return ["🥤 *Drinks*", ...lines, "", "Reply with the *drink number* (e.g. *1*)"].join("\n");
};

const renderDeals = () => {
  const lines = MENU.deals.map((d, i) => `${i + 1}. ${d.name} — ${money(d.price)}`);
  return ["💥 *Deals & Combos*", ...lines, "", "Reply with the *deal number* (e.g. *1*)"].join("\n");
};

const cartSummary = (cart) => {
  if (!cart || !cart.length) return "🛒 Your cart is empty.";
  let total = 0;
  const lines = cart.map((c, i) => {
    const line = `${i + 1}. ${c.label} x${c.qty} — ${money(c.price * c.qty)}`;
    total += c.price * c.qty;
    return line;
  });
  lines.push("");
  lines.push(`Subtotal: *${money(total)}*`);
  return ["🛒 *Your Cart*", ...lines].join("\n");
};

const pushCart = (s, label, unitPrice, qty = 1) => {
  s.cart = s.cart || [];
  s.cart.push({ label, price: unitPrice, qty });
};

const clearSession = (from) => {
  delete sessions[from];
};

const saveToAirtable = async (rec) => {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}`;
  // Join all cart items into one line for "Order Item", sum qty for "Quantity"
  const itemsList = rec.cart.map((c) => `${c.label} x${c.qty}`).join(" | ");
  const totalQty = rec.cart.reduce((a, b) => a + (Number(b.qty) || 0), 0);

  const fields = {
    "Restaurant ID": "alnoor",
    "Phone Number": `+${rec.from}`,
    "Order Item": itemsList,
    "Quantity": totalQty,
    "Address": rec.address || "",
    "Status": "Pending",
    "Order Type": rec.orderType || "Takeaway",
    "Order Time": new Date().toISOString(),
  };

  await axios.post(
    url,
    { fields },
    { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}`, "Content-Type": "application/json" } }
  );
};

// ======== WEBHOOK VERIFY ========
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ======== WEBHOOK RECEIVE ========
app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = msg?.from; // "614...."
    if (!from) return res.sendStatus(200);

    const bodyText =
      (msg.type === "text" ? msg.text?.body : "").trim();

    // Normalise for matching, but keep original for address capture
    const low = bodyText.toLowerCase();

    // new / restart / help
    if (["hi", "hello", "start"].includes(low)) {
      sessions[from] = { step: "categories", cart: [] };
      await sendText(from, welcomeText());
      await sendText(from, renderCategories());
      return res.sendStatus(200);
    }
    if (["restart", "reset", "7"].includes(low)) {
      sessions[from] = { step: "categories", cart: [] };
      await sendText(from, "Flow restarted.");
      await sendText(from, renderCategories());
      return res.sendStatus(200);
    }
    if (["help"].includes(low)) {
      await sendText(
        from,
        "Commands: *menu* (categories), *cart* (view), *checkout*, *restart*.\nReply with numbers to choose."
      );
      return res.sendStatus(200);
    }
    if (["menu"].includes(low)) {
      const s = (sessions[from] ||= { step: "categories", cart: [] });
      s.step = "categories";
      await sendText(from, renderCategories());
      return res.sendStatus(200);
    }
    if (["cart"].includes(low)) {
      const s = (sessions[from] ||= { step: "categories", cart: [] });
      await sendText(from, cartSummary(s.cart));
      return res.sendStatus(200);
    }

    // ensure session
    const s = (sessions[from] ||= { step: "categories", cart: [] });

    // ====== FLOW ======
    if (s.step === "categories") {
      // expecting 1-4
      if (["1", "2", "3", "4"].includes(low)) {
        s.category = low;
        if (low === "1") {
          s.step = "pizza-pick";
          await sendText(from, renderPizzas());
        } else if (low === "2") {
          s.step = "side-pick";
          await sendText(from, renderSides());
        } else if (low === "3") {
          s.step = "drink-pick";
          await sendText(from, renderDrinks());
        } else if (low === "4") {
          s.step = "deal-pick";
          await sendText(from, renderDeals());
        }
      } else if (["checkout"].includes(low)) {
        s.step = "order-type";
        await sendText(from, "Choose order type: *Delivery*, *Takeaway*, or *Dine-in*");
      } else {
        await sendText(from, "Please choose a valid option.\n\n" + renderCategories());
      }
      return res.sendStatus(200);
    }

    // ----- PIZZAS -----
    if (s.step === "pizza-pick") {
      const index = parseInt(low, 10);
      if (!index || index < 1 || index > MENU.pizzas.length) {
        await sendText(from, "Please send a valid pizza number.\n\n" + renderPizzas());
        return res.sendStatus(200);
      }
      const chosen = MENU.pizzas[index - 1];
      s.temp = { pizzaId: chosen.id, pizzaName: chosen.name };
      s.step = "pizza-size";
      await sendText(
        from,
        `Selected: *${chosen.name}*\nChoose size: *S*, *M*, or *L*`
      );
      return res.sendStatus(200);
    }

    if (s.step === "pizza-size") {
      const size = low.toUpperCase();
      const chosen = MENU.pizzas.find((p) => p.id === s.temp?.pizzaId);
      if (!chosen || !["S", "M", "L"].includes(size)) {
        await sendText(from, "Please choose size: *S*, *M*, or *L*");
        return res.sendStatus(200);
      }
      s.temp.size = size;
      s.temp.unitPrice = chosen.prices[size];
      s.step = "pizza-qty";
      await sendText(from, `How many *${chosen.name} (${size})*? (e.g. 2)`);
      return res.sendStatus(200);
    }

    if (s.step === "pizza-qty") {
      const q = parseInt(low, 10);
      if (!q || q < 1 || q > 20) {
        await sendText(from, "Please send a valid quantity (1–20).");
        return res.sendStatus(200);
      }
      const { pizzaName, size, unitPrice } = s.temp || {};
      pushCart(s, `${pizzaName} (${size})`, unitPrice, q);
      s.temp = {};
      s.step = "categories";
      await sendText(from, "Added to cart! ✅\n\n" + cartSummary(s.cart));
      await sendText(from, renderCategories());
      return res.sendStatus(200);
    }

    // ----- SIDES -----
    if (s.step === "side-pick") {
      const idx = parseInt(low, 10);
      if (!idx || idx < 1 || idx > MENU.sides.length) {
        await sendText(from, "Please send a valid side number.\n\n" + renderSides());
        return res.sendStatus(200);
      }
      const item = MENU.sides[idx - 1];
      s.temp = { label: item.name, unitPrice: item.price };
      s.step = "side-qty";
      await sendText(from, `How many *${item.name}*? (e.g. 2)`);
      return res.sendStatus(200);
    }

    if (s.step === "side-qty") {
      const q = parseInt(low, 10);
      if (!q || q < 1 || q > 20) {
        await sendText(from, "Please send a valid quantity (1–20).");
        return res.sendStatus(200);
      }
      pushCart(s, s.temp.label, s.temp.unitPrice, q);
      s.temp = {};
      s.step = "categories";
      await sendText(from, "Added to cart! ✅\n\n" + cartSummary(s.cart));
      await sendText(from, renderCategories());
      return res.sendStatus(200);
    }

    // ----- DRINKS -----
    if (s.step === "drink-pick") {
      const idx = parseInt(low, 10);
      if (!idx || idx < 1 || idx > MENU.drinks.length) {
        await sendText(from, "Please send a valid drink number.\n\n" + renderDrinks());
        return res.sendStatus(200);
      }
      const item = MENU.drinks[idx - 1];
      s.temp = { label: item.name, unitPrice: item.price };
      s.step = "drink-qty";
      await sendText(from, `How many *${item.name}*? (e.g. 2)`);
      return res.sendStatus(200);
    }

    if (s.step === "drink-qty") {
      const q = parseInt(low, 10);
      if (!q || q < 1 || q > 20) {
        await sendText(from, "Please send a valid quantity (1–20).");
        return res.sendStatus(200);
      }
      pushCart(s, s.temp.label, s.temp.unitPrice, q);
      s.temp = {};
      s.step = "categories";
      await sendText(from, "Added to cart! ✅\n\n" + cartSummary(s.cart));
      await sendText(from, renderCategories());
      return res.sendStatus(200);
    }

    // ----- DEALS -----
    if (s.step === "deal-pick") {
      const idx = parseInt(low, 10);
      if (!idx || idx < 1 || idx > MENU.deals.length) {
        await sendText(from, "Please send a valid deal number.\n\n" + renderDeals());
        return res.sendStatus(200);
      }
      const item = MENU.deals[idx - 1];
      pushCart(s, item.name, item.price, 1);
      s.step = "categories";
      await sendText(from, "Deal added to cart! ✅\n\n" + cartSummary(s.cart));
      await sendText(from, renderCategories());
      return res.sendStatus(200);
    }

    // ----- CHECKOUT -----
    if (["checkout"].includes(low)) {
      s.step = "order-type";
      await sendText(from, "Choose order type: *Delivery*, *Takeaway*, or *Dine-in*");
      return res.sendStatus(200);
    }

    if (s.step === "order-type") {
      if (!["delivery", "takeaway", "dine-in", "dine in"].includes(low)) {
        await sendText(from, "Please type one of: *Delivery*, *Takeaway*, *Dine-in*");
        return res.sendStatus(200);
      }
      s.orderType = low.includes("delivery") ? "Delivery" : (low.includes("takeaway") ? "Takeaway" : "Dine-in");
      if (s.orderType === "Delivery") {
        s.step = "address";
        await sendText(from, "Please send your *delivery address*.");
      } else {
        s.address = "";
        s.step = "confirm";
        // Show summary
        await sendText(from, cartSummary(s.cart));
        await sendText(from, `Order Type: *${s.orderType}*\n\nType *confirm* to place your order, or *restart* to start over.`);
      }
      return res.sendStatus(200);
    }

    if (s.step === "address") {
      // capture original text (not lowercase)
      const address = bodyText.trim();
      if (!address || address.length < 5) {
        await sendText(from, "Address looks too short. Please send a valid delivery address.");
        return res.sendStatus(200);
      }
      s.address = address;
      s.step = "confirm";
      await sendText(from, cartSummary(s.cart));
      await sendText(from, `Order Type: *${s.orderType}*\nAddress: *${s.address}*\n\nType *confirm* to place your order, or *restart* to start over.`);
      return res.sendStatus(200);
    }

    if (s.step === "confirm") {
      if (low === "confirm") {
        if (!s.cart || !s.cart.length) {
          await sendText(from, "Your cart is empty. Type *menu* to start.");
          s.step = "categories";
          return res.sendStatus(200);
        }
        await saveToAirtable({ from, cart: s.cart, address: s.address, orderType: s.orderType });
        clearSession(from);
        await sendText(from, "🎉 Your order has been placed successfully! Type *menu* to order again.");
      } else {
        await sendText(from, "Please type *confirm* to place your order, or *restart* to start over.");
      }
      return res.sendStatus(200);
    }

    // default fallback
    await sendText(from, "Type *menu* to browse, *cart* to view cart, or *checkout* to finish.");
    return res.sendStatus(200);
  } catch (e) {
    // swallow errors to prevent retries storm
    console.error("Webhook error:", e.response?.data || e.message);
    return res.sendStatus(200);
  }
});

// ======== HEALTH ========
app.get("/health", (_req, res) => res.send("ok"));

// ======== START ========
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Al Noor Pizza bot running on :${PORT}`));
