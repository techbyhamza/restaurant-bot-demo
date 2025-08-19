// ===== Simple in-memory session store =====
const S = new Map(); // key=waId, value=session state

// ===== Menu =====
const MENU = [
  { code: "P1", name: 'Pepperoni Pizza (8")' },
  { code: "P2", name: 'Margherita Pizza (8")' },
  { code: "B1", name: "Beef Burger" },
  { code: "F1", name: "Fries" }
];

const MAIN_MENU = `Welcome 👋
*1)* Place an Order
*9)* Help
*7)* Restart`;

const ORDER_TYPES = [
  { k: "1", v: "Delivery" },
  { k: "2", v: "Takeaway" },
  { k: "3", v: "Dine-in" }
];

function renderMenu() {
  const lines = MENU.map(i => `• *${i.code}* — ${i.name}`);
  return `Menu 📖\n${lines.join("\n")}\n\nReply with the *code* (e.g., P1).`;
}

function renderOrderTypes() {
  return `Choose order type:
1) Delivery
2) Takeaway
3) Dine-in`;
}

function summaryText(o) {
  return `Order Summary ✅
• Type: ${o.orderType}
• Item: ${o.item} ×${o.qty}
• Payment: ${o.paymentMethod}

Type *Confirm* to place the order, or *7* to restart.`;
}

// ===== WhatsApp message handler =====
async function handleMessage(waId, textRaw) {
  const text = (textRaw || "").trim();
  // restart
  if (text === "7" || /restart/i.test(text)) {
    S.delete(waId);
    return MAIN_MENU;
  }

  let ss = S.get(waId);
  if (!ss) {
    S.set(waId, { step: "HOME" });
    return MAIN_MENU;
  }

  // State machine
  switch (ss.step) {
    case "HOME": {
      if (text === "1") {
        ss.step = "ORDER_TYPE";
        return renderOrderTypes();
      } else if (text === "9") {
        return `Help ℹ️
- Send *1* to place an order
- Send *7* to restart at any time`;
      } else {
        return `Please choose a valid option.\n\n${MAIN_MENU}`;
      }
    }

    case "ORDER_TYPE": {
      const sel = ORDER_TYPES.find(x => x.k === text);
      if (!sel) return `Invalid choice. Please reply 1, 2 or 3.\n\n${renderOrderTypes()}`;
      ss.orderType = sel.v;
      ss.step = "PICK_ITEM";
      return renderMenu();
    }

    case "PICK_ITEM": {
      const item = MENU.find(i => i.code.toLowerCase() === text.toLowerCase());
      if (!item) return `Unknown code. Please use one from the list.\n\n${renderMenu()}`;
      ss.item = item.name;
      ss.step = "QTY";
      return `How many *${item.name}*? (e.g., 1 or 2)`;
    }

    case "QTY": {
      const n = Number(text);
      if (!Number.isInteger(n) || n <= 0 || n > 20) {
        return `Please enter a valid quantity (1–20).`;
      }
      ss.qty = n;
      ss.step = "PAY";
      return `Choose payment (dummy): *Pay at Counter* or *Card*.`;
    }

    case "PAY": {
      const t = text.toLowerCase();
      if (t !== "card" && t !== "pay at counter") {
        return `Please reply either *Card* or *Pay at Counter*.`;
      }
      ss.paymentMethod = t === "card" ? "Card" : "Pay at Counter";

      // If Delivery, ask address; else go summary
      if (ss.orderType === "Delivery") {
        ss.step = "ADDRESS";
        return `Please share delivery address 🏠`;
      } else {
        ss.address = "";
        ss.step = "CONFIRM";
        return summaryText(ss);
      }
    }

    case "ADDRESS": {
      if (!text || text.length < 4) return `Please enter a valid address.`;
      ss.address = text;
      ss.step = "CONFIRM";
      return summaryText(ss);
    }

    case "CONFIRM": {
      if (/^confirm$/i.test(text)) {
        // Save to Airtable
        const result = await saveToAirtable({
          phone: waId,
          item: ss.item,
          qty: ss.qty,
          address: ss.address || "",
          orderType: ss.orderType,
          paymentMethod: ss.paymentMethod
        });

        if (result.ok) {
          S.delete(waId);
          return `🎉 *Order confirmed!* (Ticket: ${result.id || "N/A"})\nWe’ll notify you when it’s ready.\n\n${MAIN_MENU}`;
        } else {
          return `Sorry, we couldn’t save your order right now. Please try again, or type *7* to restart.`;
        }
      }
      return `Please type *Confirm* to place the order, or *7* to restart.`;
    }

    default:
      S.delete(waId);
      return MAIN_MENU;
  }
}
