// market-depth.routes.ts
// Order book walk endpoint — shows how much you'd actually pay to buy N units of an item
// by walking sell orders from cheapest to most expensive.

import { Router, Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { parsePositiveInt } from '../utils/validation';
import { getMarketDepth } from '../services/market-depth.service';

const router = Router();

// GET /api/market-depth/:typeId?quantity=N
// Returns the sell order book walk for a single item type.
// Each step shows one order: price, volume available, quantity we'd buy, line cost.
router.get('/:typeId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const typeId   = parsePositiveInt(req.params['typeId'], 'typeId');
    const quantity = parsePositiveInt(req.query['quantity'] as string, 'quantity');
    const regionId = config.primaryRegionId;

    const result = await getMarketDepth(typeId, regionId, quantity);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
