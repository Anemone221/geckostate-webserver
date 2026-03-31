// sync.routes.ts
// Manual trigger endpoints for ESI data syncs.
// Useful for testing and for forcing a refresh outside the cron schedule.
// In production the cron jobs call these same functions automatically.

import { Router, Request, Response, NextFunction } from 'express';
import { syncMarketOrders, syncLpOffers } from '../services/esi.service';
import { config } from '../config';

const router = Router();

// POST /api/sync/market
// Triggers a full market order sync for the primary region.
// Takes a minute or two — fetches all pages from ESI and upserts to MongoDB.
router.post('/market', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const count = await syncMarketOrders(config.primaryRegionId);
    res.json({ ok: true, ordersUpserted: count });
  } catch (err) {
    next(err);
  }
});

// POST /api/sync/lp-offers
// Triggers LP store offer sync for all known NPC corporations.
// Fetches from ESI, skips corps with no LP store (404), upserts to lp_offers.
router.post('/lp-offers', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const count = await syncLpOffers();
    res.json({ ok: true, offersUpserted: count });
  } catch (err) {
    next(err);
  }
});

export default router;
