
# WhatsApp Restaurant Bot — Hamza tailored

What’s set:
- Delivery + Dine-in **enabled** for all brands (pickup also available)
- Payments: Cash on Delivery, Pay Online (manual link/note), Pay at Counter/Table (on arrival)
- Optional Google Sheets logging via Apps Script (set `SHEETS_WEBAPP_URL` in `.env`)

Run:
```
npm install
npm start
```
Then:
```
ngrok http 3000
```
Twilio WhatsApp Sandbox → When a message comes in:
```
https://YOUR_NGROK_URL/whatsapp
```

Edit `CONFIG` in `index.js` to change menus, prices, payment notes, or to toggle features per brand.
