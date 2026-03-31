// manufacturing.routes.ts
// Manufacturing profit analysis endpoint.
// Returns a full cost/revenue breakdown for building an item from its blueprint.
//
// Requires authentication — uses character-specific settings (broker fee, tax).

import { Router, Request, Response, NextFunction } from 'express';
import { getManufacturingAnalysis } from '../services/manufacturing.service';
import { config } from '../config';
import { requireAuth } from '../middleware/auth.middleware';
import { parsePositiveInt } from '../utils/validation';

const router = Router();

// All manufacturing routes require authentication
router.use(requireAuth);

// GET /api/manufacturing/:typeId
// Returns manufacturing profit breakdown for the item with this typeId.
// 404 if no manufacturing blueprint exists for this item.
router.get('/:typeId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const typeId = parsePositiveInt(req.params['typeId'], 'typeId');
    const characterId = req.session.characterId!;

    const regionId = config.primaryRegionId;
    const result = await getManufacturingAnalysis(typeId, regionId, characterId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
