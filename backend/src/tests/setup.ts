// setup.ts
// Runs before EACH test file.
// Connects mongoose to the in-memory MongoDB (started in globalSetup.ts)
// and clears all collections so every test file starts with a clean slate.

import mongoose from 'mongoose';
import { beforeAll, afterAll, beforeEach } from 'vitest';

beforeAll(async () => {
  const uri = process.env['MONGO_TEST_URI'];
  if (!uri) throw new Error('MONGO_TEST_URI not set — globalSetup may not have run');
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri);
  }
});

beforeEach(async () => {
  // Drop all collections before each test to ensure isolation
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key]!.deleteMany({});
  }
});

afterAll(async () => {
  // Don't disconnect here — the globalSetup teardown handles it
  // Disconnecting per-file would break other test files still running
});
