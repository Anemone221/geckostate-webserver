// corp-trading.routes.ts
// API endpoints for corporation trading data.
//
// All routes require authentication (requireAuth middleware).
// The character must have the required ESI scopes and corporation roles.
//
// Endpoints:
//   GET  /divisions              — list wallet divisions
//   GET  /orders                 — open corporation market orders
//   GET  /transactions           — interpreted transactions with matched fees
//   GET  /journal                — raw journal entries
//   GET  /fee-summary            — aggregated fee breakdown
//   POST /sync                   — trigger manual sync
//   GET  /settings               — get corp trading settings
//   PUT  /settings               — update corp trading settings

import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';
import { WITHDRAWAL_CATEGORIES, ESI_SCOPES } from '../constants';
import type { WithdrawalCategory } from '../constants';
import { Character } from '../models/character.model';
import { CorpOrder } from '../models/corp-order.model';
import { CorpDivision } from '../models/corp-division.model';
import { CorpTradingSettings } from '../models/corp-trading-settings.model';
import { WalletJournal } from '../models/wallet-journal.model';
import {
  syncCorpOrders,
  syncCorpTransactions,
  syncCorpJournal,
  syncCorpDivisions,
  syncCorpIndustryJobs,
} from '../services/corp-trading-sync.service';
import {
  getInterpretedTransactions,
  getFeeSummary,
} from '../services/corp-trading-interpretation.service';

const router = Router();

// All routes require auth
router.use(requireAuth);

// ─── Helper: get current character's corporation ID ──────────────────────────

async function getCharacterCorpId(characterId: number): Promise<number | null> {
  const character = await Character.findOne(
    { characterId },
    { corporationId: 1 }
  ).lean();
  return character?.corporationId || null;
}

// ─── GET /divisions ──────────────────────────────────────────────────────────

router.get('/divisions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const corpId = await getCharacterCorpId(req.session.characterId!);
    if (!corpId) throw new AppError(400, 'Character has no corporation ID. Try re-logging.');

    const divisions = await CorpDivision.find(
      { corporationId: corpId, isWallet: true },
      { division: 1, name: 1, _id: 0 }
    )
      .sort({ division: 1 })
      .lean();

    // If no divisions synced yet, return defaults (1–7)
    if (divisions.length === 0) {
      const defaults = Array.from({ length: 7 }, (_, i) => ({
        division: i + 1,
        name: `Division ${i + 1}`,
      }));
      return res.json(defaults);
    }

    res.json(divisions);
  } catch (err) {
    next(err);
  }
});

// ─── GET /orders ─────────────────────────────────────────────────────────────

router.get('/orders', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const corpId = await getCharacterCorpId(req.session.characterId!);
    if (!corpId) throw new AppError(400, 'Character has no corporation ID');

    const orders = await CorpOrder.find(
      { corporationId: corpId },
      { _id: 0, __v: 0, createdAt: 0, updatedAt: 0 }
    )
      .sort({ issued: -1 })
      .lean();

    // Batch-load item names from item_types collection
    const typeIds = [...new Set(orders.map(o => o.typeId))];
    const itemsColl = mongoose.connection.collection('item_types');
    const items = await itemsColl
      .find({ typeId: { $in: typeIds } }, { projection: { typeId: 1, typeName: 1 } })
      .toArray();
    const nameMap = new Map(items.map(i => [i['typeId'] as number, i['typeName'] as string]));

    const result = orders.map(o => ({
      ...o,
      typeName: nameMap.get(o.typeId) ?? `Type ${o.typeId}`,
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─── GET /transactions ───────────────────────────────────────────────────────

router.get('/transactions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const corpId = await getCharacterCorpId(req.session.characterId!);
    if (!corpId) throw new AppError(400, 'Character has no corporation ID');

    const division = parseInt(req.query['division'] as string) || 1;
    const limit = Math.min(parseInt(req.query['limit'] as string) || 100, 1000);

    const transactions = await getInterpretedTransactions(corpId, division, limit);
    res.json(transactions);
  } catch (err) {
    next(err);
  }
});

// ─── GET /journal ────────────────────────────────────────────────────────────

router.get('/journal', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const corpId = await getCharacterCorpId(req.session.characterId!);
    if (!corpId) throw new AppError(400, 'Character has no corporation ID');

    const division = parseInt(req.query['division'] as string) || 1;
    const limit = Math.min(parseInt(req.query['limit'] as string) || 100, 1000);

    const entries = await WalletJournal.find(
      { corporationId: corpId, division },
      { _id: 0, __v: 0, createdAt: 0, updatedAt: 0 }
    )
      .sort({ date: -1 })
      .limit(limit)
      .lean();

    res.json(entries);
  } catch (err) {
    next(err);
  }
});

// ─── GET /fee-summary ────────────────────────────────────────────────────────

router.get('/fee-summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const corpId = await getCharacterCorpId(req.session.characterId!);
    if (!corpId) throw new AppError(400, 'Character has no corporation ID');

    const division = parseInt(req.query['division'] as string) || 1;
    const days = Math.min(parseInt(req.query['days'] as string) || 30, 365);

    const summary = await getFeeSummary(corpId, division, days, req.session.characterId!);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

// ─── GET /journal-ref-types (debug) ──────────────────────────────────────────

router.get('/journal-ref-types', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const corpId = await getCharacterCorpId(req.session.characterId!);
    if (!corpId) throw new AppError(400, 'Character has no corporation ID');

    const division = parseInt(req.query['division'] as string) || 1;

    const refTypes = await WalletJournal.distinct('refType', {
      corporationId: corpId,
      division,
    });

    res.json({ corporationId: corpId, division, refTypes: refTypes.sort() });
  } catch (err) {
    next(err);
  }
});

// ─── GET /withdrawals ────────────────────────────────────────────────────────

router.get('/withdrawals', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const corpId = await getCharacterCorpId(req.session.characterId!);
    if (!corpId) throw new AppError(400, 'Character has no corporation ID');

    const division = parseInt(req.query['division'] as string) || 1;

    const entries = await WalletJournal.find(
      { corporationId: corpId, division, refType: 'corporation_account_withdrawal' },
      { _id: 0, __v: 0, createdAt: 0, updatedAt: 0 }
    )
      .sort({ date: -1 })
      .lean();

    res.json(entries);
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /withdrawals/:journalId ──────────────────────────────────────────

router.patch('/withdrawals/:journalId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const corpId = await getCharacterCorpId(req.session.characterId!);
    if (!corpId) throw new AppError(400, 'Character has no corporation ID');

    const journalId = parseInt(req.params['journalId']);
    if (isNaN(journalId)) throw new AppError(400, 'Invalid journal ID');

    const { division, category } = req.body as { division: number; category: WithdrawalCategory };
    if (!WITHDRAWAL_CATEGORIES.includes(category)) {
      throw new AppError(400, `Invalid category. Must be one of: ${WITHDRAWAL_CATEGORIES.join(', ')}`);
    }
    const div = parseInt(String(division)) || 1;

    const result = await WalletJournal.findOneAndUpdate(
      { journalId, corporationId: corpId, division: div, refType: 'corporation_account_withdrawal' },
      { $set: { category, isLpPurchase: category === 'lp_purchase' } },
      { new: true }
    );

    if (!result) throw new AppError(404, 'Withdrawal entry not found');
    res.json({ ok: true, category: result.category });
  } catch (err) {
    next(err);
  }
});

// ─── GET /lp-store-purchases ─────────────────────────────────────────────────

router.get('/lp-store-purchases', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const corpId = await getCharacterCorpId(req.session.characterId!);
    if (!corpId) throw new AppError(400, 'Character has no corporation ID');

    const division = parseInt(req.query['division'] as string) || 1;
    const since = req.query['since'] as string | undefined;

    const query: Record<string, unknown> = {
      corporationId: corpId,
      division,
      refType: 'lp_store',
    };
    if (since) query['date'] = { $gte: new Date(since) };

    const entries = await WalletJournal.find(
      query,
      { _id: 0, __v: 0, createdAt: 0, updatedAt: 0 }
    )
      .sort({ date: -1 })
      .lean();

    res.json(entries);
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /lp-store-purchases/:journalId ───────────────────────────────────

router.patch('/lp-store-purchases/:journalId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const corpId = await getCharacterCorpId(req.session.characterId!);
    if (!corpId) throw new AppError(400, 'Character has no corporation ID');

    const journalId = parseInt(req.params['journalId']);
    if (isNaN(journalId)) throw new AppError(400, 'Invalid journal ID');

    const { division, category } = req.body as { division: number; category: WithdrawalCategory };
    if (!WITHDRAWAL_CATEGORIES.includes(category)) {
      throw new AppError(400, `Invalid category. Must be one of: ${WITHDRAWAL_CATEGORIES.join(', ')}`);
    }
    const div = parseInt(String(division)) || 1;

    const result = await WalletJournal.findOneAndUpdate(
      { journalId, corporationId: corpId, division: div, refType: 'lp_store' },
      { $set: { category, isLpPurchase: category === 'lp_purchase' } },
      { new: true }
    );

    if (!result) throw new AppError(404, 'LP store purchase entry not found');
    res.json({ ok: true, category: result.category });
  } catch (err) {
    next(err);
  }
});

// ─── POST /sync ──────────────────────────────────────────────────────────────

router.post('/sync', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const characterId = req.session.characterId!;
    const corpId = await getCharacterCorpId(characterId);
    if (!corpId) throw new AppError(400, 'Character has no corporation ID');

    // Sync corp orders (corp-wide, not per-division)
    const orderCount = await syncCorpOrders(characterId, corpId);

    // Sync transactions + journal for all 7 wallet divisions.
    // ESI returns empty arrays for unused divisions, so overhead is minimal.
    let txCount = 0;
    let journalCount = 0;
    for (let div = 1; div <= 7; div++) {
      txCount += await syncCorpTransactions(characterId, corpId, div);
      journalCount += await syncCorpJournal(characterId, corpId, div);
    }

    // Sync division names (lightweight, single call)
    await syncCorpDivisions(characterId, corpId);

    // Sync industry jobs (only if character has the scope)
    const character = await Character.findOne({ characterId }).lean();
    let industryCount = 0;
    if (character?.scopes?.includes(ESI_SCOPES.CORP_INDUSTRY)) {
      industryCount = await syncCorpIndustryJobs(characterId, corpId);
    }

    // Update sync timestamps
    const now = new Date();
    await CorpTradingSettings.findOneAndUpdate(
      { accountId: req.session.accountId },
      {
        $set: {
          corporationId: corpId,
          lastOrderSync: now,
          lastTransactionSync: now,
          lastJournalSync: now,
        },
        $setOnInsert: {
          walletDivision: 1,
        },
      },
      { upsert: true }
    );

    res.json({
      ok: true,
      synced: {
        orders: orderCount,
        transactions: txCount,
        journal: journalCount,
        industry: industryCount,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /settings ───────────────────────────────────────────────────────────

router.get('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const settings = await CorpTradingSettings.findOne(
      { accountId: req.session.accountId },
      { _id: 0, __v: 0, createdAt: 0, updatedAt: 0 }
    ).lean();

    if (!settings) {
      // Return defaults
      return res.json({
        corporationId: 0,
        walletDivision: 1,
        lastOrderSync: null,
        lastTransactionSync: null,
        lastJournalSync: null,
      });
    }

    res.json(settings);
  } catch (err) {
    next(err);
  }
});

// ─── PUT /settings ───────────────────────────────────────────────────────────

router.put('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { walletDivision } = req.body;

    // Validate division (1–7)
    if (walletDivision !== undefined) {
      const div = parseInt(walletDivision);
      if (isNaN(div) || div < 1 || div > 7) {
        throw new AppError(400, 'walletDivision must be 1–7');
      }
    }

    const corpId = await getCharacterCorpId(req.session.characterId!);
    const div = walletDivision !== undefined ? parseInt(walletDivision) : undefined;

    const settings = await CorpTradingSettings.findOneAndUpdate(
      { accountId: req.session.accountId },
      {
        $set: {
          ...(div !== undefined && { walletDivision: div }),
          corporationId: corpId || 0,
        },
        $setOnInsert: {
          accountId: req.session.accountId,
          ...(div === undefined && { walletDivision: 1 }),
        },
      },
      { upsert: true, new: true, projection: { _id: 0, __v: 0 } }
    );

    res.json(settings);
  } catch (err) {
    next(err);
  }
});

export default router;
