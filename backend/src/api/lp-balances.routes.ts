// lp-balances.routes.ts
// Per-account LP balances — GET to read all, PUT to set one.
//
// Why manual entry?
//   The ESI API has no endpoint for corporation LP balances.
//   Users enter their current LP for each corp they run so the analysis can show
//   how many full redemptions they can currently afford.
//   This is purely informational — LP balance never filters results.
//
// LP balances are per-account (not per-character) because LP is transferable.
//
// Requires authentication — balances are scoped to the logged-in account.

import { Router, Request, Response, NextFunction } from 'express';
import { LpBalance } from '../models/lp-balance.model';
import { AppError } from '../middleware/error.middleware';
import { requireAuth } from '../middleware/auth.middleware';
import { parsePositiveInt } from '../utils/validation';
import { validateCorporationExists } from '../services/lp-rates.helper';

const router = Router();

// All LP balance routes require authentication
router.use(requireAuth);

// GET /api/lp-balances
// Returns all LP balance records for this account.
// currentLp is null if the user hasn't entered a balance for that corp.
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const accountId = req.session.accountId!;

    const balances = await LpBalance.find(
      { accountId },
      { corporationId: 1, corporationName: 1, currentLp: 1 },
    )
      .sort({ corporationName: 1 })
      .lean();
    res.json(balances);
  } catch (err) {
    next(err);
  }
});

// PUT /api/lp-balances/:corporationId
// Sets the current LP balance for one corporation on this account.
// Creates the record if it doesn't exist yet (upsert).
// Body: { "currentLp": 50000 }
// Pass null to clear: { "currentLp": null }
router.put('/:corporationId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const accountId = req.session.accountId!;
    const corporationId = parsePositiveInt(req.params['corporationId'], 'corporationId');

    const { currentLp } = req.body as { currentLp: unknown };

    if (currentLp !== null && (typeof currentLp !== 'number' || currentLp < 0)) {
      throw new AppError(400, 'currentLp must be a non-negative number or null');
    }

    // Look up corp name from SDE seed rows so we can store it for display
    const corporationName = await validateCorporationExists(corporationId);

    const updated = await LpBalance.findOneAndUpdate(
      { accountId, corporationId },
      {
        $set: {
          corporationName,
          currentLp: currentLp ?? null,
        },
      },
      {
        new: true,
        upsert: true,
        projection: { corporationId: 1, corporationName: 1, currentLp: 1 },
      },
    ).lean();

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
