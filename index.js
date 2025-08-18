// index.js — Guided Order Bot (AIRTABLE_API_KEY envs + SEND_WA toggle)
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const qs = require('qs');

const {
  AIRTABLE_API_KEY,
  AIRTABLE_BASE_ID,
  AIRTABLE_TABLE_NAME,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM,
  SEND_WA // "1" to actually send via Twilio; "0" to log-only
} = process.env;

const SEND_WHATSAPP = SEND_WA !== '0'; // default true
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// -------- Idempotency & Debounce --------
const PROCESSED_SIDS = new Map();
const LAST_USER_MSG  = new Map();
function seenSid(sid){
  if(!sid) return false;
  const now=Date.now();
  for(const [k,t] of PROCESSED_SIDS) if(now-t>10*60*1000) PROCESSED_SIDS.delete(k);
  if(PROCESSED_SIDS.has(sid)) return true;
  PROCESSED_SIDS.set(sid, now); return false;
}
function nearDuplicate(phone, text, step){
  const prev = LAST_USER_MSG.get(phone);
  const now = Date.now();
  LAST_USER_MSG.set(phone, { text, at: now, step });
  return prev && prev.step===step && prev.text===text && (now - prev.at) < 8000;
}

// -------- Data --------
const RESTAURANTS = [
  { key:'alnoor', name:'Al Noor Pizza',
    menu:[ {id:1,name:'Veg Pizza'}, {id:2,name:'Chicken Pizza'}, {id:3,name:'Cheese Garlic Bread'}, {id:4,name:'Coke 1.25L'} ] },
  { key:'firstchoice', name:'First Choice',
    menu:[ {id:1,name:'Chicken Biryani'}, {id:2,name:'Chicken Karahi'}, {id:3,name:'Tandoori Naan'}, {id:4,name:'Soft Drink'} ] }
];

const SESSION = Object.create(null); // phone -> { step, ... }
const PM_OPTIONS = [
  { id:1, key:'cod',     label:'Cash on Delivery' },
  { id:2, key:'counter', label:'Pay at Counter'   },
  { id:3, key:'card',    label:'Card'             },
];

// -------- Helpers --------
const norm = s => (s||'').trim().toLowerCase();
function startSession(phone){ SESSION[phone]={ step:'restaurant' }; return SESSION[phone]; }
function resetSession(phone){ delete SESSION[phone]; return startSession(phone); }
function getRestaurantByIndex(i){ return RESTAURANTS[i-1]||null; }
function getRestaurantByNameGuess(t){
  const x=norm(t);
  if(x.includes('al noor')||x.includes('alnoor')) return RESTAURANTS.find(r=>r.key==='alnoor');
  if(x.includes('first choice')||x.includes('firstchoice')) return RESTAURANTS.find(r=>r.key==='firstchoice');
  return null;
}

const renderRestaurantsPrompt = () => {
  const lines = RESTAURANTS.map((r,i)=>`${i+1}. ${r.name}`).join('\n');
  return `👋 Welcome!\n\n🏪 *Select a restaurant*\n${lines}\n\nReply with a number (e.g. *1*) or name (e.g. *Al Noor*).\n(Type *restart* anytime.)`;
};
const renderMenuPrompt = (r) => {
  const lines = r.menu.map(m=>`${m.id}. ${m.name}`).join('\n');
  return `✅ Selected: *${r.name}*\n\n📋 *${r.name} Menu*\n${lines}\n\nPlease send *item number* or *exact item name*.`;
};
const renderQtyPrompt = (item) => `🧮 *Quantity for* "${item}"?\nReply with a number (e.g. *2*).`;
const renderAddressPrompt = () => `📍 *Please share your delivery address* (street, suburb, postcode).`;
const renderPaymentPrompt = () => {
  const opts = PM_OPTIONS.map(p=>`${p.id}. ${p.label}`).join('\n');
  return `💳 *Choose payment method*\n${opts}\n\nReply with a number (e.g. *1*).`;
};
const renderSummary = s =>
  `🧾 *Order Summary*\nRestaurant: ${s.restaurantName}\nItem: ${s.item}\nQuantity: ${s.quantity}\nAddress: ${s.address}\nPayment: ${s.payment}\n\n✅ Thanks! Your order has been placed. Status: *Pending*.`;

// Twilio send (respects SEND_WHATSAPP)
async function sendWA(to, body){
  if (!SEND_WHATSAPP) {
    console.log('[WA LOG-ONLY]', { to, body });
    return;
  }
  const basicAuth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  return axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    qs.stringify({ To: to, From: TWILIO_WHATSAPP_FROM, Body: body }),
    { headers:{ Authorization:`Basic ${basicAuth}`, 'Content-Type':'application/x-www-form-urlencoded' }, timeout:10000 }
  ).catch(e=>console.error('[WA error]', e.response?.data || e.message));
}

// Airtable save with fallback (Full -> Minimal). Never throws.
async function saveAirtableSafe(order){
  if(!AIRTABLE_BASE_ID || !AIRTABLE_API_KEY || !AIRTABLE_TABLE_NAME){
    console.warn('[AT] Missing env — skip save'); return false;
  }
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`;
  const headers = { Authorization:`Bearer ${AIRTABLE_API_KEY}`, 'Content-Type':'application/json' };

  const payloadFull = { fields:{
    'Phone Number': order.phone,
    'Restaurant'  : order.restaurantName,
    'Order Item'  : order.item,
    'Quantity'    : order.quantity,
    'Address'     : order.address,
    'Payment Method': order.payment,
    'Status'      : 'Pending',
    'Order Time'  : new Date().toISOString()
  }};
  const payloadMinimal = { fields:{
    'Phone Number': order.phone,
    'Restaurant'  : order.restaurantName,
    'Order Item'  : order.item,
    'Quantity'    : order.quantity,
    'Address'     : order.address,
    'Order Time'  : new Date().toISOString()
  }};

  try{
    await axios.post(url, payloadFull, { headers, timeout:12000 });
    console.log('[AT] Saved FULL'); return true;
  }catch(e){
    console.warn('[AT] FULL failed:', e?.response?.status, e?.response?.data || e.message);
    try{
      await axios.post(url, payloadMinimal, { headers, timeout:12000 });
      console.log('[AT] Saved MINIMAL'); return true;
    }catch(e2){
      console.error('[AT] MINIMAL failed:', e2?.response?.status, e2?.response?.data || e2.message);
      return false;
    }
  }
}

// -------- Routes --------
app.get('/', (_req,res)=>res.send(`🚀 Guided Order Bot running (SEND_WA=${SEND_WHATSAPP?'1':'0'})`));

app.post('/whatsapp', async (req,res)=>{
  const sid   = req.body.MessageSid;
  const from  = req.body.From || '';
  const phone = from.replace('whatsapp:', '');
  const raw   = (req.body.Body||'').trim();

  res.status(200).send('OK'); // instant ACK
  if (seenSid(sid)) return;

  try{
    const lower = norm(raw);
    const toReply = from;

    if(['hi','hello','start'].includes(lower)){
      resetSession(phone);
      await sendWA(toReply, renderRestaurantsPrompt());
      return;
    }
    if(lower==='restart' || lower==='reset'){
      resetSession(phone);
      await sendWA(toReply, `🔄 Flow restarted.\n\n${renderRestaurantsPrompt()}`);
      return;
    }

    const s = SESSION[phone] || startSession(phone);

    if(s.step==='restaurant'){
      let chosen=null;
      const num = raw.match(/^\s*(\d+)\s*$/);
      if(num) chosen = getRestaurantByIndex(parseInt(num[1],10));
      if(!chosen) chosen = getRestaurantByNameGuess(raw);

      if(!chosen){ await sendWA(toReply, `❌ Invalid choice.\n\n${renderRestaurantsPrompt()}`); return; }

      s.restaurantKey = chosen.key; s.restaurantName = chosen.name; s.step='item';
      await sendWA(toReply, renderMenuPrompt(chosen)); return;
    }

    if(s.step==='item'){
      const rest = RESTAURANTS.find(r=>r.key===s.restaurantKey);
      if(!rest){ s.step='restaurant'; await sendWA(toReply, renderRestaurantsPrompt()); return; }

      let itemObj=null;
      const byNum = raw.match(/^\s*(\d+)\s*$/);
      if(byNum) itemObj = rest.menu.find(m=>m.id===parseInt(byNum[1],10));
      if(!itemObj) itemObj = rest.menu.find(m=> norm(m.name)===lower || norm(m.name).includes(lower) || lower.includes(norm(m.name)));

      if(!itemObj){ await sendWA(toReply, `❌ Item not found.\n\n${renderMenuPrompt(rest)}`); return; }

      s.item=itemObj.name; s.step='qty';
      await sendWA(toReply, renderQtyPrompt(s.item)); return;
    }

    if(s.step==='qty'){
      const q=parseInt(raw,10);
      if(!q || q<1 || q>999){ await sendWA(toReply, `❌ Please send a valid quantity (1-999).\n\n${renderQtyPrompt(s.item)}`); return; }
      s.quantity=q; s.step='address';
      await sendWA(toReply, renderAddressPrompt()); return;
    }

    if(s.step==='address'){
      if(nearDuplicate(phone, raw, 'address')){ s.step='payment'; await sendWA(toReply, renderPaymentPrompt()); return; }
      if(!raw || raw.length<3){ await sendWA(toReply, `❌ Address looks too short.\n\n${renderAddressPrompt()}`); return; }
      s.address=raw; s.step='payment';
      await sendWA(toReply, renderPaymentPrompt()); return;
    }

    if(s.step==='payment'){
      let pm=null;
      const numMatch = raw.match(/^\s*(\d+)[\s\.\)]*.*$/);
      if(numMatch) pm = PM_OPTIONS.find(p=>p.id===parseInt(numMatch[1],10));
      if(!pm){
        const synonyms = {
          'cash on delivery':1,'cod':1,'cash':1,
          'pay at counter':2,'counter':2,'pay':2,
          'card':3,'online':3,'visa':3,'mastercard':3
        };
        const key = Object.keys(synonyms).find(k=>lower.includes(k));
        if(key) pm = PM_OPTIONS.find(p=>p.id===synonyms[key]);
      }
      if(!pm){ await sendWA(toReply, `❌ Invalid choice.\n\n${renderPaymentPrompt()}`); return; }

      s.payment=pm.label; s.step='confirm';

      // save (fire-and-forget)
      saveAirtableSafe({
        phone,
        restaurantName:s.restaurantName,
        item:s.item, quantity:s.quantity,
        address:s.address, payment:s.payment
      }).catch(()=>{});

      await sendWA(toReply, renderSummary(s));
      resetSession(phone); return;
    }

    await sendWA(toReply, `ℹ️ Let's continue your order.\nCurrent step: *${s.step}*`);
  }catch(err){
    console.error('❌ Handler error:', err.response?.data || err.message);
    try{ if(req.body.From) await sendWA(req.body.From, '⚠️ Something went wrong. Type *restart* to start over.'); }catch{}
  }
});

app.listen(PORT, ()=>console.log(`✅ Guided Order Bot on ${PORT} (SEND_WA=${SEND_WHATSAPP?'1':'0'})`));
