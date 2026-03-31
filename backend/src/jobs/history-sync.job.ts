// history-sync.job.ts
// Daily cron job that keeps market_history up to date from EveRef.
//
// How it works:
//   1. Finds the most recent date in market_history for our region
//   2. Calculates how many days are missing between that date and yesterday
//   3. Imports all missing days (oldest first), not just yesterday
//
// This makes the job self-healing — if the server was down for a week,
// or EveRef was temporarily unavailable, the next successful run
// catches up automatically instead of only importing one day.
//
// Schedule: '0 12 * * *' = 12:00 UTC every day
//   EVE Online has a daily downtime at 11:00 UTC. EveRef processes
//   and publishes data after downtime, so 12:00 UTC gives them time
//   to finalize yesterday's data before we fetch it.

import cron from 'node-cron';
import { importHistoryForDate } from '../services/everef.service';
import { config } from '../config';
import { MarketHistory } from '../models/market-history.model';

/**
 * Find the most recent history date we have stored for our region.
 * Returns null if the collection is empty (fresh database).
 */
async function getLatestHistoryDate(regionId: number): Promise<Date | null> {
  const latest = await MarketHistory.findOne({ regionId })
    .sort({ date: -1 })
    .select('date')
    .lean();
  return latest?.date ?? null;
}

/**
 * Calculate missing dates between the day after `latestDate` and yesterday (inclusive).
 * If latestDate is null (empty DB), defaults to importing the last 7 days.
 */
function getMissingDates(latestDate: Date | null): Date[] {
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  yesterday.setUTCHours(0, 0, 0, 0);

  let startDate: Date;
  if (latestDate) {
    // Start from the day after the most recent record
    startDate = new Date(latestDate);
    startDate.setUTCDate(startDate.getUTCDate() + 1);
    startDate.setUTCHours(0, 0, 0, 0);
  } else {
    // No history at all — import the last 7 days as a starting point
    startDate = new Date(yesterday);
    startDate.setUTCDate(startDate.getUTCDate() - 6);
  }

  // Cap at 30 days max to avoid extremely long backfills
  const thirtyDaysAgo = new Date(yesterday);
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 29);
  if (startDate < thirtyDaysAgo) {
    startDate = thirtyDaysAgo;
  }

  const dates: Date[] = [];
  const current = new Date(startDate);
  while (current <= yesterday) {
    dates.push(new Date(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

/**
 * Import all missing history days, logging progress and errors.
 * Continues past failures so one bad day doesn't block the rest.
 */
async function syncMissingHistory(regionId: number): Promise<void> {
  const latestDate = await getLatestHistoryDate(regionId);
  const latestStr = latestDate ? latestDate.toISOString().split('T')[0] : '(none)';

  const missingDates = getMissingDates(latestDate);

  if (missingDates.length === 0) {
    console.log(`[HistorySync] Already up to date (latest: ${latestStr}).`);
    return;
  }

  console.log(
    `[HistorySync] Latest history: ${latestStr}. ` +
    `Importing ${missingDates.length} missing day(s)...`
  );

  let imported = 0;
  let failed = 0;

  for (const date of missingDates) {
    const dateStr = date.toISOString().split('T')[0];
    try {
      const count = await importHistoryForDate(date, regionId);
      console.log(`[HistorySync] ${dateStr}: ${count} records.`);
      imported++;
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 404) {
        console.log(`[HistorySync] ${dateStr}: not yet available on EveRef.`);
      } else {
        console.error(
          `[HistorySync] ${dateStr}: FAILED —`,
          err instanceof Error ? err.message : err
        );
      }
      failed++;
    }
  }

  console.log(
    `[HistorySync] Done. Imported: ${imported}, failed/skipped: ${failed}.`
  );
}

export function startHistorySyncJob(): void {
  cron.schedule('0 12 * * *', async () => {
    console.log('[HistorySync] Starting daily history sync...');
    try {
      await syncMissingHistory(config.primaryRegionId);
    } catch (err) {
      console.error(
        '[HistorySync] Unexpected error:',
        err instanceof Error ? err.message : err
      );
    }
  });

  console.log('[HistorySync] Daily history sync scheduled (runs at 12:00 UTC, after EVE downtime).');
}
