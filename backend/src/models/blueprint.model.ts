// blueprint.model.ts
// Stores manufacturing blueprint data imported from the CCP SDE.
// A blueprint defines what materials you need to produce an item.
//
// Key concepts:
//   activityId 1 = Manufacturing (build the item from raw materials)
//   activityId 8 = Invention    (research a T1 blueprint into a T2 blueprint)
//
// Example: Blueprint for "Rifter" (a frigate)
//   Activity 1 (Manufacturing):
//     Materials: [{ typeId: 34, quantity: 20000 }, { typeId: 35, quantity: 8000 }, ...]
//     Products:  [{ typeId: 587, quantity: 1 }]  <- 1x Rifter
//
// Material Efficiency (ME): in-game research reduces material quantities.
// We store base quantities from SDE; the analysis service applies ME reduction at query time.

import mongoose, { Schema, Document } from 'mongoose';

// One material entry: "you need X units of item Y"
interface IBlueprintMaterial {
  typeId: number;
  quantity: number;
}

// One product entry: "this activity produces X units of item Y"
interface IBlueprintProduct {
  typeId: number;
  quantity: number;
  probability?: number;  // For invention: chance of success (0–1)
}

export interface IBlueprint extends Document {
  blueprintTypeId: number;  // typeId of the blueprint item itself
  activityId: number;       // 1=manufacturing, 8=invention
  time: number;             // base production time in seconds
  materials: IBlueprintMaterial[];
  products: IBlueprintProduct[];
}

const BlueprintMaterialSchema = new Schema<IBlueprintMaterial>(
  { typeId: Number, quantity: Number },
  { _id: false }  // Don't generate _id for sub-documents
);

const BlueprintProductSchema = new Schema<IBlueprintProduct>(
  { typeId: Number, quantity: Number, probability: Number },
  { _id: false }
);

const BlueprintSchema = new Schema<IBlueprint>({
  blueprintTypeId: { type: Number, required: true, index: true },
  activityId:      { type: Number, required: true },
  time:            { type: Number, required: true, default: 0 },
  materials:       [BlueprintMaterialSchema],
  products:        [BlueprintProductSchema],
});

// Compound index: look up "all manufacturing activities for blueprint X"
BlueprintSchema.index({ blueprintTypeId: 1, activityId: 1 });

// Index on product typeId + activityId: allows "find manufacturing blueprint that produces item X"
BlueprintSchema.index({ 'products.typeId': 1, activityId: 1 });

export const Blueprint = mongoose.model<IBlueprint>('Blueprint', BlueprintSchema, 'blueprints');
