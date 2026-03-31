// lp-rates.helper.ts
// Shared helpers for LP rate queries used by lp.routes.ts and lp-rates.routes.ts.

import { LpStoreRate } from '../models/lp-store-rate.model';
import { AppError } from '../middleware/error.middleware';

export interface MergedLpRate {
  corporationId: number;
  corporationName: string;
  iskPerLp: number | null;
}

// Returns LP rates with account-specific overrides merged on top of SDE seed data.
// If filterCorpIds is provided, only those corporations are returned.
export async function getMergedLpRates(
  accountId: string,
  filterCorpIds?: number[]
): Promise<MergedLpRate[]> {
  const corpFilter = filterCorpIds ? { $in: filterCorpIds } : undefined;

  const seedQuery: Record<string, unknown> = { accountId: null };
  const accountQuery: Record<string, unknown> = { accountId };
  if (corpFilter) {
    seedQuery['corporationId'] = corpFilter;
    accountQuery['corporationId'] = corpFilter;
  }

  const [seedRates, accountRates] = await Promise.all([
    LpStoreRate.find(seedQuery, { corporationId: 1, corporationName: 1, iskPerLp: 1 })
      .sort({ corporationName: 1 })
      .lean(),
    LpStoreRate.find(accountQuery, { corporationId: 1, iskPerLp: 1 }).lean(),
  ]);

  const overrides = new Map<number, number | null>();
  for (const ar of accountRates) {
    overrides.set(ar.corporationId, ar.iskPerLp);
  }

  return seedRates.map((s) => ({
    corporationId: s.corporationId,
    corporationName: s.corporationName,
    iskPerLp: overrides.has(s.corporationId) ? overrides.get(s.corporationId)! : s.iskPerLp,
  }));
}

// Validates that a corporation exists in the SDE seed data and returns its name.
// Throws a 404 AppError if not found.
export async function validateCorporationExists(
  corporationId: number
): Promise<string> {
  const seedRow = await LpStoreRate.findOne(
    { corporationId, accountId: null },
    { corporationName: 1 },
  ).lean();
  if (!seedRow) throw new AppError(404, `Corporation ${corporationId} not found`);
  return seedRow.corporationName;
}
