// everef.service.ts
// Downloads and imports historical market data from EveRef (https://data.everef.net).
//
// What EveRef provides:
//   Daily CSV files containing price history for every item in every region.
//   Each file covers one calendar day across ALL regions and ALL items.
//   Files are bz2-compressed to keep them manageable (~600 KB compressed per day).
//
// File URL pattern:
//   https://data.everef.net/market-history/YYYY/market-history-YYYY-MM-DD.csv.bz2
//
// CSV column names (from EveRef docs):
//   date, region_id, type_id, average, highest, lowest, order_count, volume
//
// What we do:
//   - Download one day's file as a stream
//   - Decompress the bz2 stream on the fly using unbzip2-stream
//   - Parse the CSV stream using csv-parse
//   - Filter rows to only the target region (default: The Forge / Jita, regionId 10000002)
//   - Batch upsert to market_history collection
//
// Why we filter to one region:
//   A single day's file covers ~60 regions × ~15,000 items = ~900,000 rows.
//   We only care about Jita prices for analysis, so filtering keeps the DB lean.
//   You can pass a different regionId if needed.
//
// Run with: npm run import:history  (imports last 30 days, configurable via env vars)

import axios from 'axios';
import { parse } from 'csv-parse';
import unbzip2 from 'unbzip2-stream';
import { config } from '../config';
import { MarketHistory } from '../models/market-history.model';

import { HISTORY_BATCH_SIZE as BATCH_SIZE } from '../constants';

// Formats a Date as YYYY-MM-DD (UTC) for use in file URLs and date comparisons.
function formatDateUtc(date: Date): string {
  return date.toISOString().split('T')[0];
}

// Waits N milliseconds — used to be polite to EveRef's servers between downloads.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Single day import ────────────────────────────────────────────────────────

// Downloads and imports market history for a single date and region.
// Throws on HTTP errors so the caller can decide whether to skip or abort.
export async function importHistoryForDate(date: Date, regionId: number): Promise<number> {
  const dateStr = formatDateUtc(date);
  const year = date.getUTCFullYear();
  const url = `${config.data.everefBaseUrl}/market-history/${year}/market-history-${dateStr}.csv.bz2`;

  process.stdout.write(`  ${dateStr}: downloading...`);

  const response = await axios.get<NodeJS.ReadableStream>(url, {
    responseType: 'stream',
    headers: { 'User-Agent': config.esi.userAgent },
    timeout: 120_000, // 2 min timeout per file
  });

  // Build a streaming pipeline:
  //   HTTP response stream → bz2 decompressor → CSV parser → filter + batch write
  const csvParser = parse({
    columns: true,        // first row is the header
    skip_empty_lines: true,
    cast: false,          // keep everything as strings; we cast manually below
  });

  let batch: Parameters<typeof MarketHistory.bulkWrite>[0] = [];
  let count = 0;

  // Pipe HTTP → bz2 → CSV
  response.data.pipe(unbzip2()).pipe(csvParser);

  // Read parsed CSV rows one at a time using async iteration.
  // csv-parse Transform streams implement Symbol.asyncIterator.
  for await (const row of csvParser as AsyncIterable<Record<string, string>>) {
    // Skip rows for other regions — we only store what we need
    if (Number(row['region_id']) !== regionId) continue;

    const typeId = Number(row['type_id']);
    const date = new Date(row['date']);

    batch.push({
      updateOne: {
        filter: { typeId, regionId, date },
        update: {
          $set: {
            typeId,
            regionId,
            date,
            average: Number(row['average']),
            highest: Number(row['highest']),
            lowest: Number(row['lowest']),
            volume: Number(row['volume']),
            orderCount: Number(row['order_count']),
          },
        },
        upsert: true,
      },
    });

    if (batch.length >= BATCH_SIZE) {
      await MarketHistory.bulkWrite(batch.splice(0, BATCH_SIZE), { ordered: false });
      count += BATCH_SIZE;
    }
  }

  // Flush any remaining rows that didn't fill a full batch
  if (batch.length > 0) {
    await MarketHistory.bulkWrite(batch, { ordered: false });
    count += batch.length;
  }

  process.stdout.write(`\r  ${dateStr}: ${count} records for region ${regionId}\n`);
  return count;
}

// ─── Range import ─────────────────────────────────────────────────────────────

// Imports market history for the last N days for the given region.
// Starts from yesterday (today's file may not be published yet by EveRef).
// Skips 404s gracefully — older dates sometimes have missing files.
// Adds a 300ms pause between downloads to avoid hammering EveRef.
export async function importHistoryRange(days: number, regionId: number): Promise<void> {
  console.log(`Importing last ${days} days of market history for region ${regionId}...`);
  console.log(`(Each file is ~600 KB compressed)\n`);

  // Use yesterday as the most recent date since today's file is often not yet available
  const latest = new Date();
  latest.setUTCDate(latest.getUTCDate() - 1);
  latest.setUTCHours(0, 0, 0, 0);

  let totalRecords = 0;
  let filesImported = 0;
  let filesSkipped = 0;

  for (let i = 0; i < days; i++) {
    const date = new Date(latest);
    date.setUTCDate(date.getUTCDate() - i);

    try {
      const count = await importHistoryForDate(date, regionId);
      totalRecords += count;
      filesImported++;
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 404) {
        console.log(`  ${formatDateUtc(date)}: not found on EveRef, skipping.`);
        filesSkipped++;
      } else {
        // Other errors (network timeout, parse error, etc.) — log and continue
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  ${formatDateUtc(date)}: error — ${message}`);
        filesSkipped++;
      }
    }

    // Be polite to EveRef's servers between requests
    if (i < days - 1) await sleep(300);
  }

  console.log(`\nHistory import complete.`);
  console.log(`  Files imported: ${filesImported}`);
  console.log(`  Files skipped:  ${filesSkipped}`);
  console.log(`  Total records:  ${totalRecords}`);
}
