// index.js
import express from 'express';
import bodyParser from 'body-parser';

const app = express();
const PORT = process.env.PORT || 8080;

// Env vars (Railway Settings → Variables میں سیٹ کریں)
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;   // مثال: hamza-verify-123
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;   // WhatsApp Cloud API User Access Token
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID; // WhatsApp Business Phone Number ID

app.use(bodyParser.json());

// Health check route
app.get('/', (req, res) => {
  res.status(200).send('Server is running ✅');
});

/**
 * Webhook Verification (GET)
 * یہ Meta Developers کے Webhook Verify کیلئے ہے
 */
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified ✅');
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

/**
 * Webhook Receive (POST)
 * WhatsApp سے آنے والے messages یہاں آئیں گے
 */
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    if (body.object === 'whatsapp_business_account') {
      body.entry?.forEach(entry => {
        entry.changes?.forEach(change => {
          const value = change.value || {};
          const messages = value.messages || [];

          messages.forEach(msg => {
            const from = msg.from;         // User کا نمبر
            const text = msg.text?.body;   // Message body

            if (text) {
              console.log(`📩 Message from ${from}: ${text}`);
              sendWhatsAppText(from, `آپ نے لکھا: "${text}" ✅`);
            }
          });
        });
      });
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Webhook error:', err);
    res.sendStatus(500);
  }
});

/**
 * Helper function: WhatsApp API کے ذریعے رپلائی بھیجنا
 */
async function sendWhatsAppText(to, text) {
  const resp = await fetch(`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text }
    })
  });

  if (!resp.ok) {
    const error = await resp.text();
    console.error('❌ Send error:', resp.status, error);
  } else {
    console.log('✅ Reply sent successfully');
  }
}

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
