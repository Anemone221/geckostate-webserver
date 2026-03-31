// lp-rates.routes.ts
// Per-account ISK/LP rates — GET to read all, PUT to set one.
// The ISK/LP rate is the user's estimate of what 1 LP is worth in ISK for a given corp.
// It varies by content type and market conditions, so users set it manually.
//
// LP rates are per-account (not per-character) because LP is transferable
// between characters and purchase rates are donation-based.
//
// Requires authentication — rates are scoped to the logged-in account.

import { Router, Request, Response, NextFunction } from 'express';
import { LpStoreRate } from '../models/lp-store-rate.model';
import { AppError } from '../middleware/error.middleware';
import { requireAuth } from '../middleware/auth.middleware';
import { parsePositiveInt } from '../utils/validation';
import { getMergedLpRates, validateCorporationExists } from '../services/lp-rates.helper';

const router = Router();

// All LP rate routes require authentication
router.use(requireAuth);

// GET /api/lp-rates
// Returns all corporation records with their current ISK/LP rate for this account.
// Falls back to the SDE seed rows (accountId=null) for corp names.
// Merges account-specific rates on top of the seed data.
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const accountId = req.session.accountId!;
    const result = await getMergedLpRates(accountId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// PUT /api/lp-rates/:corporationId
// Sets the ISK/LP rate for one corporation on this account.
// Body: { "iskPerLp": 3000 }
// Pass null to clear the rate: { "iskPerLp": null }
router.put('/:corporationId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const accountId = req.session.accountId!;
    const corporationId = parsePositiveInt(req.params['corporationId'], 'corporationId');

    const { iskPerLp } = req.body as { iskPerLp: unknown };

    if (iskPerLp !== null && (typeof iskPerLp !== 'number' || iskPerLp < 0)) {
      throw new AppError(400, 'iskPerLp must be a non-negative number or null');
    }

    // Verify the corporation exists in seed data
    const corporationName = await validateCorporationExists(corporationId);

    // Upsert the account-specific rate
    const updated = await LpStoreRate.findOneAndUpdate(
      { accountId, corporationId },
      {
        $set: {
          iskPerLp: iskPerLp ?? null,
          corporationName,
        },
      },
      {
        new: true,
        upsert: true,
        projection: { corporationId: 1, corporationName: 1, iskPerLp: 1 },
      },
    ).lean();

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
