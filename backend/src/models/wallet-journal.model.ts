// wallet-journal.model.ts
// Stores corporation wallet journal entries fetched from ESI.
//
// ESI endpoint: GET /corporations/{corporation_id}/wallets/{division}/journal/
// Scope: esi-wallet.read_corporation_wallets.v1
//
// Journal entries record every ISK movement in the wallet: market sales,
// broker fees, sales tax, bounties, insurance payouts, etc.
//
// Key refType values for market interpretation:
//   - "market_transaction"  → ISK from a completed buy/sell
//   - "transaction_tax"     → sales tax charged on a sale
//   - "brokers_fee"         → broker fee for placing or modifying an order
//   - "market_escrow"       → ISK placed/returned from buy order escrow
//
// The contextId + contextIdType fields link journal entries to specific
// orders or transactions, enabling the interpretation layer to match
// fees to the transactions that caused them.

import mongoose, { Schema, Document } from 'mongoose';

export interface IWalletJournal extends Document {
  journalId:     number;            // ESI: id — unique per journal entry
  corporationId: number;            // the corporation that owns this wallet
  division:      number;            // wallet division (1–7)
  date:          Date;              // when this entry was recorded
  refType:       string;            // type of ISK movement (see list above)
  amount:        number;            // ISK amount (positive = received, negative = paid)
  balance:       number;            // wallet balance after this entry
  firstPartyId:  number | null;     // entity on one side of the transaction
  secondPartyId: number | null;     // entity on the other side
  description:   string;            // human-readable description from CCP
  contextId:     number | null;     // related ID (order_id, transaction_id, etc.)
  contextIdType: string | null;     // what contextId refers to
  reason:        string;            // player-entered reason (e.g. for corp transfers)
  isLpPurchase:  boolean | null;    // user-tagged: is this withdrawal an LP purchase? (only for corporation_account_withdrawal)
}

const WalletJournalSchema = new Schema<IWalletJournal>(
  {
    journalId:     { type: Number, required: true },
    corporationId: { type: Number, required: true },
    division:      { type: Number, required: true },
    date:          { type: Date, required: true },
    refType:       { type: String, required: true },
    amount:        { type: Number, required: true },
    balance:       { type: Number, required: true },
    firstPartyId:  { type: Number, default: null },
    secondPartyId: { type: Number, default: null },
    description:   { type: String, default: '' },
    contextId:     { type: Number, default: null },
    contextIdType: { type: String, default: null },
    reason:        { type: String, default: '' },
    isLpPurchase:  { type: Boolean, default: null },
  },
  { timestamps: true }
);

// One journal entry per (journalId, corporationId, division)
WalletJournalSchema.index(
  { journalId: 1, corporationId: 1, division: 1 },
  { unique: true }
);
// For querying by date range and type (used by interpretation service)
WalletJournalSchema.index({ corporationId: 1, division: 1, date: -1 });
// For distinct refType queries (debug endpoint)
WalletJournalSchema.index({ corporationId: 1, division: 1, refType: 1 });

export const WalletJournal = mongoose.model<IWalletJournal>(
  'WalletJournal',
  WalletJournalSchema,
  'wallet_journal'
);
