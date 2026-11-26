import { fetchAliExpressPageLinks, parseAliExpressPageUrl } from "../lib/aliExpressPageLinks.js";
import { Router, type Request, type Response } from "express";
import {
  aliExpressConnectionStatus, aliExpressErrorMessage, beginAliExpressAuthorization,
  disconnectAliExpress, managedAliExpressAccessToken,
} from "../lib/aliexpressOAuth.js";
import { inspectDropshipSearch } from "../lib/aliexpressDropship.js";

import { logger } from "../lib/logger.js";

const router = Router();
const path = "/admin/aliexpress/connection";

function action(handler: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    res.set("Cache-Control", "no-store");
    try {
      await handler(req, res);
    } catch (error) {
      res.status(502).json({ error: aliExpressErrorMessage(error) });
    }
  };
}

router.get(path, action(async (_req, res) => res.json(await aliExpressConnectionStatus())));
router.post(path + "/authorize", action(async (_req, res) => res.json({ url: await beginAliExpressAuthorization() })));
router.delete(path, action(async (_req, res) => {
  await disconnectAliExpress();
  res.json(await aliExpressConnectionStatus());
}));
router.post(path + "/renew", action(async (_req, res) => {
  if (!await managedAliExpressAccessToken({ force: true })) {
    res.status(409).json({ error: "Authorise AliExpress before renewing the connection." });
    return;
  }
  res.json(await aliExpressConnectionStatus());
}));
router.post(path + "/test", action(async (req, res) => {
  const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
  if (!query || query.length > 120) {
    res.status(400).json({ error: "Enter 1–120 characters for the product search." });
    return;
  }
  const { products, counts } = await inspectDropshipSearch(query, 1, { requireManaged: true });
  logger.info({ counts }, "AliExpress product search test completed");
  res.json({ count: products.length, products: products.slice(0, 5), counts });
}));

router.post("/admin/aliexpress/page-links", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const page = parseAliExpressPageUrl(typeof req.body?.url === "string" ? req.body.url.trim() : "");
  if (!page) {
    res.status(400).json({ error: "Enter an HTTPS AliExpress search, category, store or item URL." });
    return;
  }
  try {
    const links = await fetchAliExpressPageLinks(page);
    res.json({ links });
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith("AliExpress ")
      ? error.message : "Bazunk could not fetch the AliExpress page. Use the browser bookmarklet to collect its visible product links.";
    res.status(502).json({ error: message });
  }
});

export default router;
