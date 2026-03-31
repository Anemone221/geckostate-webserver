// item-type.model.ts
// Stores every item type in EVE Online, imported from the CCP SDE.
// This is the "dictionary" we use to look up item names, volumes, and categories.
// Example: typeId 34 = "Tritanium", typeId 35 = "Pyerite"

import mongoose, { Schema, Document } from 'mongoose';

export interface IItemType extends Document {
  typeId: number;
  typeName: string;
  marketGroupId: number | null;  // null = not sold on market
  volume: number;                // m³ per unit — used to calculate logistics cost
  published: boolean;            // false = removed from game, skip these
  description?: string;
}

const ItemTypeSchema = new Schema<IItemType>({
  typeId:        { type: Number, required: true, unique: true, index: true },
  typeName:      { type: String, required: true, index: true },
  marketGroupId: { type: Number, default: null },
  volume:        { type: Number, required: true, default: 0 },
  published:     { type: Boolean, required: true, default: true },
  description:   { type: String },
});

// Text index on typeName enables fast name-search queries like: ?name=tritanium
ItemTypeSchema.index({ typeName: 'text' });

export const ItemType = mongoose.model<IItemType>('ItemType', ItemTypeSchema, 'item_types');
