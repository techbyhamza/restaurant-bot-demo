import express from "express";
import axios from "axios";

// ====== ENV ======
const {
  PORT = 8080,
  VERIFY_TOKEN,            // e.g. "my-secret-123"
  ACCESS_TOKEN,            // System user token (never expose)
  PHONE_NUMBER_ID,         // e.g. "740436365822100"
  AIRTABLE_API_KEY,        // from https://airtable.com
  AIRTABLE_BASE_ID,        // Base ID, e.g. "appXXXXXXXXXXXXXX"
  AIRTABLE_TABLE_NAME = "Orders" // table name exactly as Airtable میں نظر آتا ہے
} = process.env;

// ====== APP ======
const app = express();
app.use(express.json());

// سادہ in-memory session (demo کیلئے کافی ہے)
const sessions = new Map();

// Menu mapping (اپنے مطابق بدل لیں)
const MENU = {
  "1": "Pizza",
  "2": "Burger",
  "3": "Pasta",
  "4": "Salad"
};

// ====== Helpers ======

// WhatsApp پر text بھیجنا
async function sendText(to, body) {
  const url = `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`;
  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body }
    },
    {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

// Airtable میں ریکارڈ بنانا
async function createAirtableOrder({ phone, item, quantity, address }) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(
    AIRTABLE_TABLE_NAME
  )}`;

  const fields = {
    "Phone Number": phone,
    "Order Item": item,
    "Quantity": Number(quantity),
    "Address": address,
    "Status": "Pending",
    "Order Time": new Date().toISOString()
  };

  await axios.post(
    url,
    { records: [{ fields }] },
    { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}`, "Content-Type": "application/json" } }
  );
}

// نمبر نارملائز (E.164 style رکھیں)
const normalizePhone = (waId) => (waId?.startsWith("+") ? waId : `+${waId}`);

// ====== Routes ======

// Health (optional)
app.get("/", (_, res) => res.send("OK"));
app.get("/health", (_, res) => res.json({ ok: true }));

// Webhook Verify (Meta)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Webhook Receive (Meta)
app.post("/webhook", async (req, res) => {
  try {
    const data = req.body;

    // Basic validation
    const entry = data?.entry?.[0];
    const changes = entry?.changes?.[0];
    const messages = changes?.value?.messages;
    if (!messages || !messages.length) return res.sendStatus(200);

    const msg = messages[0];
    if (msg.type !== "text") return res.sendStatus(200);

    const fromRaw = msg.from;               // e.g. "61426095847"
    const from = normalizePhone(fromRaw);   // "+61426095847"
    const text = (msg.text?.body || "").trim();

    // سیشن لوڈ / بنائیں
    let s = sessions.get(from);
    if (!s) {
      s = { step: "item" }; // item -> quantity -> address -> done
      sessions.set(from, s);
      await sendText(from,
        "👋 خوش آمدید! مہربانی کر کے menu سے آئٹم چنیں:\n1) Pizza\n2) Burger\n3) Pasta\n4) Salad\n\nنمبرا ٹائپ کریں (مثلاً 1)");
      return res.sendStatus(200);
    }

    // اسٹیٹ مشین
    if (s.step === "item") {
      const item = MENU[text];
      if (!item) {
        await sendText(from, "براہِ کرم درست آپشن بھیجیں (1-4).");
        return res.sendStatus(200);
      }
      s.item = item;
      s.step = "quantity";
      await sendText(from, `آپ نے *${item}* منتخب کیا ✅\nQuantity بتائیں (مثلاً 1 یا 2)`);
      return res.sendStatus(200);
    }

    if (s.step === "quantity") {
      const qty = parseInt(text, 10);
      if (!(qty > 0 && qty < 100)) {
        await sendText(from, "براہِ کرم درست quantity بھیجیں (مثلاً 1)");
        return res.sendStatus(200);
      }
      s.quantity = qty;
      s.step = "address";
      await sendText(from, "شکریہ! اب delivery address بھیج دیں۔");
      return res.sendStatus(200);
    }

    if (s.step === "address") {
      if (text.length < 4) {
        await sendText(from, "براہِ کرم مکمل address لکھیں۔");
        return res.sendStatus(200);
      }
      s.address = text;
      s.step = "confirm";

      await sendText(
        from,
        `✅ آرڈر خلاصہ:\n• Item: ${s.item}\n• Qty: ${s.quantity}\n• Address: ${s.address}\n\nConfirm کرنے کیلئے "yes" لکھیں یا "no" سے دوبارہ شروع کریں۔`
      );
      return res.sendStatus(200);
    }

    if (s.step === "confirm") {
      if (/^y(es)?$/i.test(text)) {
        // Airtable میں save
        await createAirtableOrder({
          phone: from,
          item: s.item,
          quantity: s.quantity,
          address: s.address
        });

        await sendText(
          from,
          "🎉 آپ کا آرڈر موصول ہو گیا ہے اور *Pending* میں درج کر دیا گیا ہے۔ شکریہ!"
        );

        sessions.delete(from); // flow ختم
      } else {
        await sendText(from, "آرڈر منسوخ ہوگیا۔ نیا آرڈر شروع کرنے کیلئے کوئی بھی میسج کریں۔");
        sessions.delete(from);
      }
      return res.sendStatus(200);
    }

    // fallback
    await sendText(from, "براہِ کرم ہدایات کے مطابق جواب دیں۔");
    return res.sendStatus(200);
  } catch (e) {
    console.error("Webhook error", e?.response?.data || e.message);
    return res.sendStatus(200);
  }
});

// ====== Start ======
app.listen(PORT, () => {
  console.log(`Server running on :${PORT}`);
});
