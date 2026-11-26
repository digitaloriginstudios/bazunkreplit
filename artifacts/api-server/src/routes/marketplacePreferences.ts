import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { authenticatedSellerEmail } from "../lib/authenticatedSeller.js";
import { shippingCountry } from "../lib/listingShipping.js";
const router = Router();
const currencies = new Set(["GBP","USD","EUR","AUD","CAD","NZD","CHF"]);
router.get("/marketplace/preferences", async (req,res) => {
  try {
    const email = await authenticatedSellerEmail(req,res); if (!email) return;
    const row = (await db.execute(sql`SELECT delivery_country,preferred_currency FROM users WHERE LOWER(email)=${email} LIMIT 1`)).rows[0];
    res.setHeader("Cache-Control","private, no-store");
    res.json(row ?? {delivery_country:null,preferred_currency:null});
  } catch { res.status(503).json({error:"Preferences unavailable"}); }
});
router.put("/marketplace/preferences", async (req,res) => {
  try {
    const email = await authenticatedSellerEmail(req,res); if (!email) return;
    const country = shippingCountry(req.body?.deliveryCountry);
    const currency = typeof req.body?.preferredCurrency === "string" ? req.body.preferredCurrency.toUpperCase() : "";
    if (!country || ["EU","ZZ","UN","XA","XB","QO"].includes(country) || !currencies.has(currency)) {
      res.status(400).json({error:"Choose a valid delivery country and display currency"}); return;
    }
    const row = (await db.execute(sql`UPDATE users SET delivery_country=${country},preferred_currency=${currency} WHERE LOWER(email)=${email} RETURNING delivery_country,preferred_currency`)).rows[0];
    if (!row) {res.status(404).json({error:"Account not found"});return;}
    res.json(row);
  } catch { res.status(503).json({error:"Preferences unavailable"}); }
});
export default router;
