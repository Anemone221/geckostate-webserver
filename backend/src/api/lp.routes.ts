// lp.routes.ts
// LP store analysis endpoints.
// Returns ranked LP offers with ISK/LP calculations for a given NPC corporation.

import { Router, Request, Response, NextFunction } from 'express';
import { LpStoreRate } from '../models/lp-store-rate.model';
import { LpOffer } from '../models/lp-offer.model';
import { Blueprint } from '../models/blueprint.model';
import { MarketHistory } from '../models/market-history.model';
import { getLpAnalysis } from '../services/lp-analysis.service';
import { getMergedLpRates } from '../services/lp-rates.helper';
import { config } from '../config';
import { AppError } from '../middleware/error.middleware';
import { requireAuth } from '../middleware/auth.middleware';
import { parsePositiveInt } from '../utils/validation';

const router = Router();

// All LP routes require authentication (settings + LP rates are scoped)
router.use(requireAuth);

// GET /api/lp/corps
// Returns all NPC corporations that have been seeded from the SDE, with their
// current ISK/LP rate (null if not yet configured by the user).
// Used by the frontend to populate the corporation selector.
router.get('/corps', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const accountId = req.session.accountId!;

    // Only return corps that have at least one LP offer seeded — no point showing empty stores
    const corpIdsWithOffers = await LpOffer.distinct('corporationId') as number[];

    const corps = await getMergedLpRates(accountId, corpIdsWithOffers);
    res.json(corps);
  } catch (err) {
    next(err);
  }
});

// GET /api/lp/history/:corporationId/:offerId
// Returns 30 days of daily cost-breakdown history for a specific LP offer.
// Used by the frontend to render a stacked cost vs. market-rate chart.
//
// Response: OfferCostHistoryPoint[] — one object per calendar day that has history data.
//   lpCostIsk         = offer.lpCost × corp ISK/LP rate (flat; 0 if rate not set)
//   iskFee            = offer.iskCost (flat ISK redemption fee)
//   requiredItemsCost = sum(reqItem.qty × historicalAvg) for that day; null if any item unpriced
//   mfgCost           = sum(mat.qty × historicalAvg) × bpcCopies; null for non-BPC or unpriced mats
//   marketRate        = outputItem.historicalAvg × outputQty; null if no history for output that day
router.get('/history/:corporationId/:offerId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const corporationId = parsePositiveInt(req.params['corporationId'], 'corporationId');
    const offerId       = parsePositiveInt(req.params['offerId'], 'offerId');

    const regionId = config.primaryRegionId;

    const accountId = req.session.accountId!;

    // ── 1. Load offer + corp LP rate (prefer account-specific, fallback to seed) ──
    const [offer, accountRate, seedRate] = await Promise.all([
      LpOffer.findOne({ corporationId, offerId }).lean(),
      LpStoreRate.findOne({ accountId, corporationId }, { iskPerLp: 1 }).lean(),
      LpStoreRate.findOne({ accountId: null, corporationId }, { iskPerLp: 1 }).lean(),
    ]);
    const lpRate = accountRate ?? seedRate;
    if (!offer) throw new AppError(404, 'Offer not found');

    const iskPerLp = lpRate?.iskPerLp ?? 0;
    const lpCostIsk = offer.lpCost * iskPerLp;

    // ── 2. Check for BPC ──
    const bp = await Blueprint.findOne(
      { blueprintTypeId: offer.typeId, activityId: 1 },
    ).lean();
    const isBpc = bp !== null && bp.products.length > 0;

    let outputTypeId: number;
    let outputQty: number;
    const bpcCopies = offer.quantity;  // number of BPC runs from the LP store

    if (isBpc && bp) {
      outputTypeId = bp.products[0]!.typeId;
      outputQty    = offer.quantity * bp.products[0]!.quantity;
    } else {
      outputTypeId = offer.typeId;
      outputQty    = offer.quantity;
    }

    // ── 3. Collect all typeIds needing history ──
    const typeIds = new Set<number>();
    typeIds.add(outputTypeId);
    for (const req of offer.requiredItems) typeIds.add(req.typeId);
    if (isBpc && bp) {
      for (const mat of bp.materials) typeIds.add(mat.typeId);
    }

    // ── 4. Query 30 days of MarketHistory ──
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);

    const history = await MarketHistory.find({
      regionId,
      typeId: { $in: [...typeIds] },
      date:   { $gte: thirtyDaysAgo },
    }, { typeId: 1, date: 1, average: 1 }).lean();

    // ── 5. Index history by typeId → date string → average price ──
    // Map<typeId, Map<"YYYY-MM-DD", avgPrice>>
    const priceByTypeDate = new Map<number, Map<string, number>>();
    for (const h of history) {
      const dateStr = h.date.toISOString().slice(0, 10);
      if (!priceByTypeDate.has(h.typeId)) priceByTypeDate.set(h.typeId, new Map());
      priceByTypeDate.get(h.typeId)!.set(dateStr, h.average);
    }

    // ── 6. Collect all distinct dates that appear in any typeId's history ──
    const allDates = new Set<string>();
    priceByTypeDate.forEach((dateMap) => dateMap.forEach((_, d) => allDates.add(d)));
    const sortedDates = [...allDates].sort();

    // ── 7. Build one point per day ──
    const points = sortedDates.map((date) => {
      const getPrice = (tid: number) => priceByTypeDate.get(tid)?.get(date) ?? null;

      // Required items cost for this day
      let requiredItemsCost: number | null = 0;
      for (const req of offer.requiredItems) {
        const p = getPrice(req.typeId);
        if (p === null) { requiredItemsCost = null; break; }
        requiredItemsCost = (requiredItemsCost ?? 0) + req.quantity * p;
      }

      // Manufacturing cost for this day (BPC only)
      let mfgCost: number | null = null;
      if (isBpc && bp) {
        mfgCost = 0;
        for (const mat of bp.materials) {
          const p = getPrice(mat.typeId);
          if (p === null) { mfgCost = null; break; }
          mfgCost = (mfgCost ?? 0) + mat.quantity * p;
        }
        if (mfgCost !== null) mfgCost *= bpcCopies;
      }

      // Market rate for this day
      const outputPrice = getPrice(outputTypeId);
      const marketRate  = outputPrice !== null ? outputPrice * outputQty : null;

      return {
        date,
        lpCostIsk,
        iskFee:           offer.iskCost,
        requiredItemsCost,
        mfgCost,
        marketRate,
      };
    });

    res.json(points);
  } catch (err) {
    next(err);
  }
});

// GET /api/lp/:corporationId
// Returns all LP store offers for a corporation, ranked by ISK/LP descending.
// Offers without market data are included (profit = null) so nothing is hidden.
router.get('/:corporationId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const corporationId = parsePositiveInt(req.params['corporationId'], 'corporationId');
    const characterId = req.session.characterId!;
    const accountId   = req.session.accountId!;

    const regionId = config.primaryRegionId;
    const results = await getLpAnalysis(corporationId, regionId, characterId, accountId);
    res.json(results);
  } catch (err) {
    next(err);
  }
});

export default router;
