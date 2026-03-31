// offer-plans.routes.ts
// API for tracking which LP store offers the user is planning or actively running.
//
// Routes:
//   GET    /api/offer-plans               → all tracked offers (optional ?status= filter)
//   PUT    /api/offer-plans/:corpId/:offerId  → mark as planning/doing (upsert)
//   DELETE /api/offer-plans/:corpId/:offerId  → stop tracking

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { OfferPlan } from '../models/offer-plan.model';
import { LpOffer } from '../models/lp-offer.model';
import { LpStoreRate } from '../models/lp-store-rate.model';
import { ItemType } from '../models/item-type.model';
import { AppError } from '../middleware/error.middleware';
import { parsePositiveInt } from '../utils/validation';

const router = Router();

// All routes require auth
router.use(requireAuth);

// GET /api/offer-plans
// Returns all tracked offers. Optional ?status=planning or ?status=doing to filter.
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = req.query;

    const filter: Record<string, unknown> = {};
    if (status === 'planning' || status === 'doing') {
      filter['status'] = status;
    }

    const plans = await OfferPlan.find(filter).sort({ addedAt: -1 }).lean();
    res.json(plans);
  } catch (err) {
    next(err);
  }
});

// PUT /api/offer-plans/:corporationId/:offerId
// Marks an offer as 'planning' or 'doing'. Creates the record if it doesn't exist.
// Body: { status: 'planning' | 'doing' }
//
// Validates that the (corporationId, offerId) pair exists in lp_offers before saving.
// This prevents tracking phantom offers that don't exist in our database.
router.put(
  '/:corporationId/:offerId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const corporationId = parsePositiveInt(req.params['corporationId'], 'corporationId');
      const offerId       = parsePositiveInt(req.params['offerId'], 'offerId');

      const { status } = req.body as { status?: unknown };
      if (status !== 'planning' && status !== 'doing') {
        throw new AppError(400, 'status must be "planning" or "doing"');
      }

      // Verify the offer exists in our LP offers collection
      const offer = await LpOffer.findOne({ corporationId, offerId }).lean();
      if (!offer) {
        throw new AppError(404, `No LP offer found for corp ${corporationId}, offer ${offerId}`);
      }

      // Look up names for denormalization (so Planning/Doing pages don't need extra queries)
      const [corp, item] = await Promise.all([
        LpStoreRate.findOne({ corporationId }, { corporationName: 1 }).lean(),
        ItemType.findOne({ typeId: offer.typeId }, { typeName: 1 }).lean(),
      ]);

      const corporationName = corp?.corporationName ?? `Corp ${corporationId}`;
      const typeName        = item?.typeName        ?? `Item ${offer.typeId}`;

      const plan = await OfferPlan.findOneAndUpdate(
        { corporationId, offerId },
        {
          $set: {
            corporationId,
            offerId,
            typeId: offer.typeId,
            corporationName,
            typeName,
            status,
          },
          $setOnInsert: { addedAt: new Date() },
        },
        { upsert: true, new: true }
      ).lean();

      res.json(plan);
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/offer-plans/:corporationId/:offerId
// Removes an offer from tracking entirely.
router.delete(
  '/:corporationId/:offerId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const corporationId = parsePositiveInt(req.params['corporationId'], 'corporationId');
      const offerId       = parsePositiveInt(req.params['offerId'], 'offerId');

      const result = await OfferPlan.deleteOne({ corporationId, offerId });

      if (result.deletedCount === 0) {
        throw new AppError(404, 'Offer plan not found');
      }

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
