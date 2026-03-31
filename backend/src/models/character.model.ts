// character.model.ts
// Stores EVE characters authenticated via CCP SSO.
// When a user logs in with their EVE account, we store their tokens here
// so we can make authenticated ESI calls on their behalf.
//
// Token lifecycle:
//   - accessToken: short-lived (20 min), used to call authenticated ESI endpoints
//   - refreshToken: permanent, used to get a new accessToken when it expires
//   - tokenExpiry: when the current accessToken expires
//
// Security note: in production, accessToken and refreshToken should be encrypted
// at rest. For now they are stored as plain strings — we will add encryption
// when we reach Phase 4 (SSO implementation).

import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ICharacter extends Document {
  characterId: number;
  characterName: string;
  corporationId: number;           // The EVE corporation this character belongs to
  accountId: Types.ObjectId;       // The account this character belongs to
  accessToken: string;
  refreshToken: string;
  tokenExpiry: Date;
  scopes: string[];    // The ESI scopes this character has authorised
  createdAt: Date;
  updatedAt: Date;
}

const CharacterSchema = new Schema<ICharacter>(
  {
    characterId:   { type: Number, required: true, unique: true },
    characterName: { type: String, required: true },
    corporationId: { type: Number, default: 0 },
    accountId:     { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    accessToken:   { type: String, required: true },
    refreshToken:  { type: String, required: true },
    tokenExpiry:   { type: Date, required: true },
    scopes:        [{ type: String }],
  },
  {
    // Mongoose automatically manages createdAt and updatedAt timestamps
    timestamps: true,
  }
);

// For listing all characters belonging to an account
CharacterSchema.index({ accountId: 1 });

export const Character = mongoose.model<ICharacter>('Character', CharacterSchema, 'characters');
