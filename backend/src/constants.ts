// constants.ts
// Shared constants used across the backend.
// Centralizes values that were previously defined in multiple files.

// ─── Batch sizes for MongoDB bulkWrite ───────────────────────────────────────

/** Default batch size for MongoDB bulkWrite operations (market orders, items, blueprints, corp data). */
export const BATCH_SIZE = 500;

/** Larger batch size for EveRef history imports (higher throughput, less granular progress). */
export const HISTORY_BATCH_SIZE = 1000;

/** Number of NPC corporations to sync LP offers for concurrently. */
export const LP_SYNC_BATCH_SIZE = 10;

// ─── ESI scopes ──────────────────────────────────────────────────────────────

/** ESI OAuth2 scopes requested during CCP SSO login. */
export const ESI_SCOPES = {
  PUBLIC_DATA:      'publicData',
  CORP_ORDERS:      'esi-markets.read_corporation_orders.v1',
  CORP_WALLETS:     'esi-wallet.read_corporation_wallets.v1',
  CORP_DIVISIONS:   'esi-corporations.read_divisions.v1',
  CORP_INDUSTRY:    'esi-industry.read_corporation_jobs.v1',
} as const;

// ─── Withdrawal categories ──────────────────────────────────────────────────

/** Valid categories for corporation withdrawal journal entries. */
export const WITHDRAWAL_CATEGORIES = [
  'lp_purchase',
  'private_sale',
  'investor_payout',
  'other',
] as const;

export type WithdrawalCategory = typeof WITHDRAWAL_CATEGORIES[number];

/** All scopes joined for the SSO authorization URL. */
export const ESI_SCOPES_STRING = Object.values(ESI_SCOPES).join(' ');

// ─── Rate limiting ───────────────────────────────────────────────────────────

export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;  // 15 minutes
export const RATE_LIMIT_MAX = 500;                     // requests per window per IP

// ─── Session ─────────────────────────────────────────────────────────────────

export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;  // 1 week
