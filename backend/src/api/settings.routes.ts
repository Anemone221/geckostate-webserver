// settings.routes.ts
// Per-character calculation settings — GET to read, PUT to update.
// These are the parameters that vary by character (skills, standings):
// broker fee, sales tax, volume cap, and logistics cost per m³.
//
// Requires authentication — settings are scoped to the logged-in character.

import { Router, Request, Response, NextFunction } from 'express';
import { Settings } from '../models/settings.model';
import { AppError } from '../middleware/error.middleware';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();

// All settings routes require authentication
router.use(requireAuth);

// GET /api/settings
// Returns the current character's settings. Creates defaults if missing.
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const characterId = req.session.characterId!;

    // Upsert: find existing or create with defaults
    const settings = await Settings.findOneAndUpdate(
      { characterId },
      { $setOnInsert: { characterId } },
      {
        new: true,
        upsert: true,
        projection: { brokerFeePct: 1, salesTaxPct: 1, weeklyVolumePct: 1, logisticsCostPerM3: 1 },
      },
    ).lean();

    res.json(settings);
  } catch (err) {
    next(err);
  }
});

// PUT /api/settings
// Updates one or more settings fields for the current character.
// Body example: { "brokerFeePct": 0.02, "salesTaxPct": 0.015 }
router.put('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const characterId = req.session.characterId!;
    const allowed = ['brokerFeePct', 'salesTaxPct', 'weeklyVolumePct', 'logisticsCostPerM3'];
    const updates: Record<string, number> = {};

    for (const key of allowed) {
      const val = (req.body as Record<string, unknown>)[key];
      if (val !== undefined) {
        if (typeof val !== 'number' || isNaN(val) || !isFinite(val) || val < 0) {
          throw new AppError(400, `${key} must be a non-negative number`);
        }
        updates[key] = val;
      }
    }

    if (Object.keys(updates).length === 0) {
      throw new AppError(400, `No valid fields provided. Allowed: ${allowed.join(', ')}`);
    }

    const updated = await Settings.findOneAndUpdate(
      { characterId },
      { $set: updates },
      {
        new: true,
        upsert: true,
        projection: { brokerFeePct: 1, salesTaxPct: 1, weeklyVolumePct: 1, logisticsCostPerM3: 1 },
        setDefaultsOnInsert: true,
      },
    ).lean();

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
