import express from "express";
import bodyParser from "body-parser";
import Airtable from "airtable";

const app = express();
app.use(bodyParser.json());

// Airtable configuration
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

// ✅ Test route to check Airtable integration
app.get("/test", async (req, res) => {
  try {
    const record = await base("Orders").create([
      {
        fields: {
          Name: "Hamza",
          Item: "Pizza",
          Quantity: 1,
        },
      },
    ]);

    res.send("✅ Record added to Airtable: " + record[0].id);
  } catch (err) {
    console.error(err);
    res.status(500).send("❌ Error adding record: " + err.message);
  }
});

// Default route
app.get("/", (req, res) => {
  res.send("🚀 Restaurant Bot Demo is running...");
});

// Server listen (Railway will use process.env.PORT)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
