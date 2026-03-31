// corp-trading-settings.model.ts
// Stores per-account configuration for the Corporation Trading feature.
//
// Each account has one settings document that specifies:
//   - Which corporation to monitor (corporationId)
//   - Which wallet division to display by default (walletDivision, 1–7)
//   - Sync timestamps for each data type
//   - Per-division cursor tokens for incremental transaction fetching
//
// All 7 wallet divisions are synced every run. The walletDivision field
// only controls which division the frontend shows by default.
//
// Scoping:
//   Per-account because corporation membership is shared across all
//   characters on an account. The background sync job iterates all
//   accounts that have corp trading configured.

import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ICorpTradingSettings extends Document {
  accountId:            Types.ObjectId;          // the account this config belongs to
  corporationId:        number;                  // EVE corp ID to monitor
  walletDivision:       number;                  // which division to show by default (1–7)
  lastOrderSync:        Date | null;             // when corp orders were last synced
  lastTransactionSync:  Date | null;             // when wallet transactions were last synced
  lastJournalSync:      Date | null;             // when wallet journal was last synced
  transactionCursors:   Map<string, string>;     // per-division cursor tokens (key = "1"-"7")
}

const CorpTradingSettingsSchema = new Schema<ICorpTradingSettings>(
  {
    accountId:            { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    corporationId:        { type: Number, required: true },
    walletDivision:       { type: Number, required: true, default: 1 },
    lastOrderSync:        { type: Date, default: null },
    lastTransactionSync:  { type: Date, default: null },
    lastJournalSync:      { type: Date, default: null },
    transactionCursors:   { type: Map, of: String, default: () => new Map() },
  },
  { timestamps: true }
);

// One config per account
CorpTradingSettingsSchema.index({ accountId: 1 }, { unique: true });
// For background sync job lookups by corporation
CorpTradingSettingsSchema.index({ corporationId: 1 });

export const CorpTradingSettings = mongoose.model<ICorpTradingSettings>(
  'CorpTradingSettings',
  CorpTradingSettingsSchema,
  'corp_trading_settings'
);
