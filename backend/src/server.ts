// server.ts
// Entry point — connects to MongoDB, then starts the HTTP server.
//
// Startup sequence:
//   1. Load config (reads .env file)
//   2. Connect to MongoDB (retry with clear error if it fails)
//   3. Seed default settings record if one doesn't exist yet
//   4. Start Express server
//
// Shutdown handling:
//   On SIGTERM (Docker stop) or SIGINT (Ctrl+C), close the server cleanly
//   so in-flight requests can finish before the process exits.

import mongoose from 'mongoose';
import { config } from './config';
import { createApp } from './app';
import { AppMeta } from './models/app-meta.model';
import { startMarketSyncJob } from './jobs/market-sync.job';
import { startHistorySyncJob } from './jobs/history-sync.job';
import { startCorpTradingSyncJob } from './jobs/corp-trading-sync.job';

// ─── Timestamped console output ──────────────────────────────────────────────
// Patches console.log/error/warn to prepend an ISO timestamp so every log line
// is traceable. Runs once at startup before anything else logs.

const origLog  = console.log.bind(console);
const origErr  = console.error.bind(console);
const origWarn = console.warn.bind(console);

const ts = () => new Date().toISOString();

console.log  = (...args: unknown[]) => origLog(ts(),  ...args);
console.error = (...args: unknown[]) => origErr(ts(),  ...args);
console.warn  = (...args: unknown[]) => origWarn(ts(), ...args);

async function start(): Promise<void> {
  // --- Connect to MongoDB ---
  console.log(`[DB] Connecting to MongoDB at ${config.mongoUri}...`);

  try {
    await mongoose.connect(config.mongoUri);
    console.log('[DB] Connected successfully.');
  } catch (err) {
    console.error('[DB] Failed to connect to MongoDB:', err);
    console.error('[DB] Make sure MongoDB is running. If using Docker: docker-compose up mongo');
    process.exit(1);
  }

  // --- Drop legacy indexes ---
  // The account system changed unique indexes on lp_store_rates and lp_balances
  // from { corporationId } to { accountId, corporationId }. MongoDB doesn't
  // auto-drop old indexes, so we remove them here if they still exist.
  for (const collName of ['lp_store_rates', 'lp_balances']) {
    const coll = mongoose.connection.collection(collName);
    try {
      const indexes = await coll.indexes();
      if (indexes.some((idx) => idx.name === 'corporationId_1')) {
        await coll.dropIndex('corporationId_1');
        console.log(`[DB] Dropped legacy index corporationId_1 from ${collName}.`);
      }
    } catch {
      // Collection may not exist yet — that's fine
    }
  }

  // --- Seed AppMeta ---
  // If this is a fresh database, create the AppMeta document for SDE version tracking.
  // Settings are now per-character and created on first login, not at startup.
  const existingMeta = await AppMeta.findOne();
  if (!existingMeta) {
    await AppMeta.create({});
    console.log('[DB] Created AppMeta record.');
  }

  // --- Start HTTP server ---
  const app = createApp();

  const server = app.listen(config.port, () => {
    console.log(`[Server] Running on http://localhost:${config.port}`);
    console.log(`[Server] Health check: http://localhost:${config.port}/api/health`);
  });

  // --- Start background jobs ---
  // These run on a cron schedule and do not block the server from starting.
  startMarketSyncJob();
  startHistorySyncJob();
  startCorpTradingSyncJob();

  // --- Graceful shutdown ---
  // When Docker stops the container, it sends SIGTERM.
  // We finish any in-progress requests before closing.
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[Server] Received ${signal}. Shutting down gracefully...`);
    server.close(async () => {
      await mongoose.disconnect();
      console.log('[Server] Shutdown complete.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

// Start the application
start().catch((err) => {
  console.error('[Server] Unexpected startup error:', err);
  process.exit(1);
});
