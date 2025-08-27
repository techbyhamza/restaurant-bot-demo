// ---- Airtable DIAGNOSTIC HELPERS ----
async function airtableQuickWrite({ baseId, tableKey, fields }) {
  const table = tableKey; // can be a tblID or table name
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`;
  const headers = {
    Authorization: `Bearer ${AIRTABLE_API_KEY}`,
    "Content-Type": "application/json",
  };

  // 1) create a tiny test row
  const createRes = await axios.post(url, { fields }, { headers });
  const recId = createRes?.data?.id;

  // 2) delete it so we don't leave noise
  if (recId) {
    await axios.delete(`${url}/${recId}`, { headers });
  }

  return { ok: true, createdId: recId };
}

// GET /diag/airtable — creates+deletes a test row in both tables
app.get("/diag/airtable", async (_req, res) => {
  try {
    const nowISO = new Date().toISOString();

    // Mandi quick write
    const mandiKey = AIRTABLE_TABLE_ID_MANDI || AIRTABLE_TABLE_MANDI;
    const r1 = await airtableQuickWrite({
      baseId: AIRTABLE_BASE_ID_MANDI,
      tableKey: mandiKey,
      fields: {
        "Phone Number": "+61400000000",
        "Order Item": "DIAG Chicken Mandi",
        "Quantity": 1,
        "Address": "Diag Street",
        "Status": "Pending",
        "Order Type": "Delivery",
        "Order Time": nowISO,
      },
    });

    // Fuadijan quick write
    const fuadijanKey = AIRTABLE_TABLE_ID_FUADIJAN || AIRTABLE_TABLE_FUADIJAN;
    const r2 = await airtableQuickWrite({
      baseId: AIRTABLE_BASE_ID_FUADIJAN,
      tableKey: fuadijanKey,
      fields: {
        "CustomerName": "Diag User",
        "PhoneNumber": "+61400000000",
        "MenuItem": "DIAG Burger",
        "Quantity": 1,
        "Address": "Diag Street",
        "OrderType": "Delivery",
        "OrderTime": nowISO,
      },
    });

    res.json({
      ok: true,
      mandi: r1,
      fuadijan: r2,
      baseIds: {
        mandi: AIRTABLE_BASE_ID_MANDI,
        fuadijan: AIRTABLE_BASE_ID_FUADIJAN,
      },
      tables: {
        mandi: mandiKey,
        fuadijan: fuadijanKey,
      },
    });
  } catch (e) {
    const apiErr = e?.response?.data || e.message || "Unknown error";
    console.error("DIAG /airtable error:", apiErr);
    res.status(500).json({ ok: false, error: apiErr });
  }
});
