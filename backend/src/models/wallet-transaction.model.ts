// wallet-transaction.model.ts
// Stores corporation wallet transactions fetched from ESI.
//
// ESI endpoint: GET /corporations/{corporation_id}/wallets/{division}/transactions/
// Scope: esi-wallet.read_corporation_wallets.v1
//
// Each transaction represents a completed buy or sell on the market.
// The journalRefId links to the corresponding wallet journal entry,
// which contains the broker fee and sales tax information.
//
// This endpoint uses cursor-based pagination (before/after opaque tokens),
// not the X-Pages pagination used by most other ESI endpoints.

import mongoose, { Schema, Document } from 'mongoose';

export interface IWalletTransaction extends Document {
  transactionId:  number;       // ESI: transaction_id — unique per transaction
  corporationId:  number;       // the corporation that owns this wallet
  division:       number;       // wallet division (1–7)
  date:           Date;         // when the transaction occurred
  typeId:         number;       // item type that was traded
  quantity:       number;       // number of units traded
  unitPrice:      number;       // ISK per unit
  clientId:       number;       // the other party in the transaction
  locationId:     number;       // station/structure where the trade happened
  isBuy:          boolean;      // true = we bought, false = we sold
  journalRefId:   number;       // links to the wallet journal entry for this transaction
}

const WalletTransactionSchema = new Schema<IWalletTransaction>(
  {
    transactionId: { type: Number, required: true },
    corporationId: { type: Number, required: true },
    division:      { type: Number, required: true },
    date:          { type: Date, required: true },
    typeId:        { type: Number, required: true },
    quantity:      { type: Number, required: true },
    unitPrice:     { type: Number, required: true },
    clientId:      { type: Number, required: true },
    locationId:    { type: Number, required: true },
    isBuy:         { type: Boolean, required: true },
    journalRefId:  { type: Number, required: true },
  },
  { timestamps: true }
);

// One transaction per (transactionId, corporationId, division)
WalletTransactionSchema.index(
  { transactionId: 1, corporationId: 1, division: 1 },
  { unique: true }
);
// For filtering transactions by corp + division
WalletTransactionSchema.index({ corporationId: 1, division: 1 });

export const WalletTransaction = mongoose.model<IWalletTransaction>(
  'WalletTransaction',
  WalletTransactionSchema,
  'wallet_transactions'
);
