// index.js
// Twilio WhatsApp -> Airtable (Orders) with debug routes
require('dotenv').config();
const express = require('express');
const { MessagingResponse } = require('twilio').twiml;
const Airtable = require('airtable');

const app = express();
app.use(express.urlencoded({ extended: false })); // Twilio form-encoded body

// ----- ENV -----
const PORT = process.env.PORT || 3000;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || 'Orders';

// ----- Airtable Setup -----
if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
  console.warn('⚠️ Missing AIRTABLE_API_KEY or AIRTABLE_BASE_ID');
}
Airtable.configure({ apiKey: AIRTABLE_API_KEY });
const base = Airtable.base(AIRTABLE_BASE_ID);
const table = base(AIRTABLE_TABLE_NAME);

// ----- Helpers -----
const nowISO = () => new Date().toISOString();

// سادہ parser: میسج سے item/qty/address نکالے
function parseOrderText(text) {
  const body = (text || '').trim();
  if (!body) return { item: '', qty: 1, address: '' };

  const simple = ['hi', 'hello', 'menu', 'start', 'urdu', 'english'];
  if (simple.includes(body.toLowerCase())) return { item: body, qty: 1, address: '' };

  const qtyMatch = body.match(/(^|\s)(\d+)(\s|$)/);
  const qty = qtyMatch ? parseInt(qtyMatch[2], 10) : 1;

  let address = '';
  const addrIdx = body.toLowerCase().indexOf('address');
  if (addrIdx !== -1) address = body.slice(addrIdx + 7).trim().replace(/^[:\- ]+/, '');

  let item = body;
  if (qtyMatch) item = item.replace(qtyMatch[0], ' ');
  if (addrIdx !== -1) item = item.slice(0, addrIdx).trim();
  if (!item) item = 'Item';

  return { item, qty: isNaN(qty) ? 1 : qty, address };
}

// ----- Health route -----
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    env: {
      AIRTABLE_API_KEY: !!AIRTABLE_API_KEY,
      AIRTABLE_BASE_ID: !!AIRTABLE_BASE_ID,
      AIRTABLE_TABLE_NAME: AIRTABLE_TABLE_NAME
    }
  });
});

// ----- Direct Airtable test (browser hit) -----
app.get('/airtable-test', async (req, res) => {
  try {
    const created = await table.create([{
      fields: {
        'Phone Number': '+61000000000',
        'Order Item'  : 'Test Item',
        'Quantity'    : 1,
        'Address'     : 'Test Address',
        'Status'      : 'Pending',
        'Order Time'  : nowISO()
      }
    }], { typecast: true }); // single-selects کیلئے
    res.json({ success: true, id: created?.[0]?.getId() });
  } catch (e) {
    console.error('Airtable TEST error:', e?.statusCode, e?.message, e?.error || e);
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

// ----- Twilio WhatsApp webhook -----
app.post('/whatsapp', async (req, res) => {
  const twiml = new MessagingResponse();
  const from = (req.body.From || '').replace('whatsapp:', ''); // +61...
  const body = req.body.Body || '';

  const { item, qty, address } = parseOrderText(body);

  try {
    const fields = {
      'Phone Number': from,
      'Order Item'  : item,
      'Quantity'    : qty,
      'Address'     : address,
      'Status'      : 'Pending',
      'Order Time'  : nowISO()
    };

    const created = await table.create([{ fields }], { typecast: true });
    const recId = created?.[0]?.getId();
    console.log('✅ Airtable record created:', recId, fields);

    const reply =
      `✅ محفوظ ہو گیا!\n• نمبر: ${from}\n• آئٹم: ${item}\n• مقدار: ${qty}\n` +
      (address ? `• ایڈریس: ${address}\n` : '') +
      `اسٹیٹس: Pending`;
    twiml.message(reply);
    res.type('text/xml').send(twiml.toString());
  } catch (e) {
    console.error('❌ Airtable create error:', { code: e?.statusCode, msg: e?.message, err: e?.error || e });
    twiml.message('⚠️ اس وقت ریکارڈ محفوظ نہیں ہو سکا، میں چیک کر رہا ہوں۔');
    res.type('text/xml').send(twiml.toString());
  }
});

// ----- Start -----
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
