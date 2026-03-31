// app-meta.model.ts
// Stores global application metadata that is NOT per-character or per-account.
//
// Currently holds SDE version tracking fields that were previously in Settings.
// There is always exactly one document in this collection.

import mongoose, { Schema, Document } from 'mongoose';

export interface IAppMeta extends Document {
  /** CCP SDE build number of the last successfully imported dataset */
  sdeBuildNumber: number | null;
  /** CCP SDE release date string of the last import */
  sdeReleaseDate: string | null;
}

const AppMetaSchema = new Schema<IAppMeta>({
  sdeBuildNumber: { type: Number, default: null },
  sdeReleaseDate: { type: String, default: null },
});

export const AppMeta = mongoose.model<IAppMeta>('AppMeta', AppMetaSchema, 'app_meta');
