// settings.model.ts
// Stores per-character calculation settings.
//
// Each character has their own broker fee, sales tax, etc. because these
// depend on character skills (Broker Relations, Accounting) and NPC standings
// which vary between characters.
//
// There is one document per character, keyed by characterId.
// When a character first logs in, a document is created with defaults.
//
// SDE metadata (sdeBuildNumber, sdeReleaseDate) moved to AppMeta model —
// those are global, not per-character.

import mongoose, { Schema, Document } from 'mongoose';

export interface ISettings extends Document {
  // Which character these settings belong to
  characterId: number;

  // Broker fee % — charged when you place a sell order
  // Default 2.02% (0.0202) — reduces with Broker Relations skill + NPC standings
  brokerFeePct: number;

  // Sales tax % — charged when your sell order fills
  // Default 1.80% (0.018) — reduces with Accounting skill (max 1.08% at V)
  salesTaxPct: number;

  // What fraction of weekly market volume you can sell without moving the price
  // Default 5% (0.05) — conservative assumption to avoid flooding the market
  weeklyVolumePct: number;

  // ISK cost per m³ to haul goods to Jita
  // Default 0 — assumes you are already in Jita or have free hauling
  logisticsCostPerM3: number;
}

const SettingsSchema = new Schema<ISettings>({
  characterId:        { type: Number, required: true, unique: true },
  brokerFeePct:       { type: Number, required: true, default: 0.0202 },
  salesTaxPct:        { type: Number, required: true, default: 0.018 },
  weeklyVolumePct:    { type: Number, required: true, default: 0.05 },
  logisticsCostPerM3: { type: Number, required: true, default: 0 },
});

export const Settings = mongoose.model<ISettings>('Settings', SettingsSchema, 'settings');
