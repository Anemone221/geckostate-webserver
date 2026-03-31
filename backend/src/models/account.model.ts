// account.model.ts
// Groups EVE characters into a single user account.
//
// The first character to log in via SSO creates a new account.
// Subsequent characters logged in from the same session are added
// under the same account. This allows:
//   - Per-character settings (broker fee, tax — depends on skills/standings)
//   - Per-account LP data (LP rates, balances — shared across characters)

import mongoose, { Schema, Document } from 'mongoose';

export interface IAccount extends Document {
  /** The characterId of the first character that created this account */
  primaryCharacterId: number;
  createdAt: Date;
  updatedAt: Date;
}

const AccountSchema = new Schema<IAccount>(
  {
    primaryCharacterId: { type: Number, required: true },
  },
  { timestamps: true },
);

export const Account = mongoose.model<IAccount>('Account', AccountSchema, 'accounts');
