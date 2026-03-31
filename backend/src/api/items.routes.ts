// items.routes.ts
// Item type lookup and search endpoints.
// Uses the item_types collection seeded by the SDE import.

import { Router, Request, Response, NextFunction } from 'express';
import { ItemType } from '../models/item-type.model';
import { AppError } from '../middleware/error.middleware';
import { parsePositiveInt } from '../utils/validation';

const router = Router();

// GET /api/items?name=tritanium
// Text search on item names. Returns up to 20 matching items.
// The ?name= query is case-insensitive (MongoDB text index).
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const name = req.query['name'] as string | undefined;
    if (!name || name.trim().length < 2) {
      throw new AppError(400, 'Query parameter ?name= must be at least 2 characters');
    }

    // Escape regex metacharacters so user input like ".*" is treated as a
    // literal string, not a regex wildcard (prevents regex injection).
    const escapedName = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Use a case-insensitive regex for partial matching (more flexible than text index)
    const items = await ItemType.find(
      { typeName: { $regex: escapedName, $options: 'i' }, published: true },
      { typeId: 1, typeName: 1, marketGroupId: 1, volume: 1 }
    )
      .limit(20)
      .lean();

    res.json(items);
  } catch (err) {
    next(err);
  }
});

// GET /api/items/:typeId
// Returns a single item by its EVE typeId.
router.get('/:typeId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const typeId = parsePositiveInt(req.params['typeId'], 'typeId');

    const item = await ItemType.findOne(
      { typeId },
      { typeId: 1, typeName: 1, marketGroupId: 1, volume: 1, published: 1 }
    ).lean();

    if (!item) throw new AppError(404, `Item ${typeId} not found`);

    res.json(item);
  } catch (err) {
    next(err);
  }
});

export default router;
