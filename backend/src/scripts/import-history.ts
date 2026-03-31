// import-history.ts
// CLI entry point for EveRef historical market data import.
// Connects to MongoDB, runs the import, then disconnects.
//
// Usage (from the backend/ directory):
//   npm run import:history
//
// Optional environment variable overrides:
//   HISTORY_DAYS=90    How many days back to import (default: 30)
//   HISTORY_REGION=10000002  Which region to import (default: PRIMARY_REGION_ID from .env)
//
// Example — import 90 days:
//   HISTORY_DAYS=90 npm run import:history
//
// Notes:
//   - Each day's file is ~600 KB compressed; 30 days downloads quickly
//   - The import adds a 300ms pause between files to avoid rate-limiting EveRef
//   - Re-running is safe — all writes are upserts (won't create duplicates)
//   - Run the SDE import first (npm run import:sde) so item_types exists

import mongoose from 'mongoose';
import { config } from '../config';
import { importHistoryRange } from '../services/everef.service';

// Allow overriding days and region via environment variables at run time.
// This makes it easy to do a deeper initial import without changing code.
const DAYS = parseInt(process.env['HISTORY_DAYS'] ?? '30', 10);
const REGION_ID = parseInt(
  process.env['HISTORY_REGION'] ?? String(config.primaryRegionId),
  10,
);

async function main(): Promise<void> {
  console.log('========================================');
  console.log('  EVE Market History Import (EveRef)');
  console.log('========================================');
  console.log(`  Region:  ${REGION_ID} (10000002 = The Forge / Jita)`);
  console.log(`  Days:    ${DAYS}`);
  console.log('');

  console.log(`Connecting to MongoDB: ${config.mongoUri}`);
  await mongoose.connect(config.mongoUri);
  console.log('Connected.\n');

  try {
    await importHistoryRange(DAYS, REGION_ID);
    console.log('\n✓ History import complete.');
  } catch (err) {
    console.error('\n✗ History import failed:');
    console.error(err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  }
}

main();
