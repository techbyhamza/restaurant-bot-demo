// index.js

const express = require('express');
const axios = require('axios');
const qs = require('qs');

const {
  AIRTABLE_BASE_ID,
  AIRTABLE_PAT,
  AIRTABLE_TABLE_NAME,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM
} = process.env;

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get('/', (req, res) => {
  res.send('🚀 WhatsApp Bot is running with Airtable!');
});

// WhatsApp webhook
app.post('/whatsapp', async (req, res) => {
  try {
    const fromFull = req.body.From || '';
    const from = fromFull.replace('whatsapp:', '');
    const raw = (req.body.Body || '').trim();

    // simple parser: first word = item, second = quantity (default = 1)
    const [item = '', qtyStr = '1'] = raw.split(/\s+/);
    const quantity = parseInt(qtyStr, 10) || 1;

    // (A) Save into Airtable
    await axios.post(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`,
      {
        fields: {
          'Phone Number': from,
          'Order Item': item || raw,
          'Quantity': quantity,
          'Status': 'Pending',
          'Order Time': new Date().toISOString()
        }
      },
      {
        headers: {
          Authorization: `Bearer ${AIRTABLE_PAT}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // (B) Send confirmation reply via Twilio REST API
    const messageBody = `Thanks! Order received: ${item || raw} x ${quantity}. Status: Pending.`;
    const basicAuth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');

    await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      qs.stringify({
        To: `whatsapp:+${from.replace(/^\+?/, '')}`,
        From: TWILIO_WHATSAPP_FROM,
        Body: messageBody
      }),
      {
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    // Always return 200 so Twilio doesn't retry
    res.status(200).send('OK');
  } catch (err) {
    console.error(err.response?.data || err.message);
    // Still return 200 on error
    res.status(200).send('OK');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
