// corp-division.model.ts
// Stores corporation wallet and hangar division names fetched from ESI.
//
// ESI endpoint: GET /corporations/{corporation_id}/divisions/
// Scope: esi-corporations.read_divisions.v1
//
// EVE corporations have up to 7 wallet divisions and 7 hangar divisions.
// Each can be renamed by directors. We store these names so the UI can
// show "Trading Wallet" instead of "Division 1".
//
// The divisions endpoint returns both wallet and hangar arrays.
// We store both (distinguished by isWallet) but primarily use wallet divisions
// for the Corp Trading feature.

import mongoose, { Schema, Document } from 'mongoose';

export interface ICorpDivision extends Document {
  corporationId: number;       // the corporation
  division:      number;       // division number (1–7)
  name:          string;       // user-customised name (or default like "1st Division")
  isWallet:      boolean;      // true = wallet division, false = hangar division
}

const CorpDivisionSchema = new Schema<ICorpDivision>(
  {
    corporationId: { type: Number, required: true },
    division:      { type: Number, required: true },
    name:          { type: String, required: true },
    isWallet:      { type: Boolean, required: true },
  },
  { timestamps: true }
);

// One record per (corp, division number, wallet/hangar)
CorpDivisionSchema.index(
  { corporationId: 1, division: 1, isWallet: 1 },
  { unique: true }
);

export const CorpDivision = mongoose.model<ICorpDivision>(
  'CorpDivision',
  CorpDivisionSchema,
  'corp_divisions'
);
