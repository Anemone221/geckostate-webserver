// import-sde.ts
// CLI entry point for the SDE import.
// Connects to MongoDB, runs the import, then disconnects.
//
// Usage (from the backend/ directory):
//   npm run import:sde
//
// Optional environment variable overrides:
//   SDE_FORCE=1          Re-import even if the stored build number matches the latest
//   LOCAL_SDE_PATH=...   Read from a local extracted folder instead of downloading the zip
//
// Examples:
//   npm run import:sde
//   SDE_FORCE=1 npm run import:sde
//   LOCAL_SDE_PATH="F:/Downloads/eve-online-static-data-3231590-jsonl" npm run import:sde
//
// Requirements:
//   - backend/.env must exist with a valid MONGO_URI
//   - If running via Docker, MongoDB must be reachable at that URI
//   - If running locally, point MONGO_URI at localhost:27017
//
// This is safe to re-run after CCP patches — all writes are upserts.

import mongoose from 'mongoose';
import { config } from '../config';
import { importSde } from '../services/sde.service';

async function main(): Promise<void> {
  console.log('========================================');
  console.log('  EVE SDE Import');
  console.log('========================================\n');

  console.log(`Connecting to MongoDB: ${config.mongoUri}`);
  await mongoose.connect(config.mongoUri);
  console.log('Connected.\n');

  try {
    const force = process.env['SDE_FORCE'] === '1';
    await importSde({ force });
    console.log('\n✓ SDE import complete.');
  } catch (err) {
    console.error('\n✗ SDE import failed:');
    console.error(err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  }
}

main();
