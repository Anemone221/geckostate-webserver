// sde.service.ts
// Downloads (or reads locally) the CCP Static Data Export and imports it into MongoDB.
//
// What the SDE is:
//   CCP publishes a JSONL zip with all static EVE game data — item names, volumes,
//   blueprint requirements, NPC corp info, etc. It updates with each game patch.
//
// JSONL format (September 2025 rework):
//   Each file contains one complete JSON object per line.
//   The ID field for each record is stored as `_key` (NOT typeID / corporationID).
//   blueprints.jsonl also has `blueprintTypeID` alongside `_key` — we use that.
//   Files sit at the ZIP ROOT — there is no `fsd/` subdirectory.
//
// What this service imports:
//   types.jsonl           → item_types collection  (names, volumes, market groups)
//   blueprints.jsonl      → blueprints collection  (materials + products per activity)
//   npcCorporations.jsonl → lp_store_rates         (seeds corp names/IDs)
//
// Version check:
//   Before importing, we fetch the latest build number from CCP and compare with
//   the stored build number in MongoDB settings. If they match, we skip the import
//   (unless SDE_FORCE=1 is set). After a successful import, we save the new build number.
//
// Local path support:
//   Set LOCAL_SDE_PATH in .env to point at an already-extracted folder on disk.
//   This skips the download entirely and reads files directly — much faster.
//
// Run with: npm run import:sde
// Force re-import: SDE_FORCE=1 npm run import:sde

import axios from 'axios';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import { pipeline } from 'stream/promises';
import unzipper from 'unzipper';
import { config } from '../config';
import { ItemType } from '../models/item-type.model';
import { Blueprint } from '../models/blueprint.model';
import { LpStoreRate } from '../models/lp-store-rate.model';
import { AppMeta } from '../models/app-meta.model';

// ─── Constants ────────────────────────────────────────────────────────────────

// Stable CCP endpoint that returns the current SDE build number.
// Returns: {"_key":"sde","buildNumber":3231590,"releaseDate":"2026-02-27T11:21:08Z"}
const SDE_VERSION_URL =
  'https://developers.eveonline.com/static-data/tranquility/latest.jsonl';

// Only store activities we actually use for market analysis.
// Manufacturing (1) = build the item.  Invention (8) = T1 → T2 blueprint.
const RELEVANT_ACTIVITIES: Record<string, number> = {
  manufacturing: 1,
  invention: 8,
};

import { BATCH_SIZE } from '../constants';

// ─── Version check helpers ────────────────────────────────────────────────────

interface BuildInfo {
  buildNumber: number;
  releaseDate: string;
}

// Gets the build number from either a local _sde.jsonl file or the remote CCP endpoint.
async function getLatestBuildInfo(): Promise<BuildInfo> {
  const localPath = config.data.localSdePath;

  if (localPath) {
    // Read _sde.jsonl from the local extracted folder
    const metaPath = path.join(localPath, '_sde.jsonl');
    const content = fs.readFileSync(metaPath, 'utf-8').trim();
    const record = JSON.parse(content) as BuildInfo & { _key: string };
    return { buildNumber: record.buildNumber, releaseDate: record.releaseDate };
  }

  // Fetch from CCP's version endpoint
  const response = await axios.get<BuildInfo & { _key: string }>(SDE_VERSION_URL, {
    headers: { 'User-Agent': config.esi.userAgent },
    timeout: 15_000,
  });
  const record = response.data;
  return { buildNumber: record.buildNumber, releaseDate: record.releaseDate };
}

// Reads the last successfully imported build number from the AppMeta document.
async function getStoredBuildNumber(): Promise<number | null> {
  const meta = await AppMeta.findOne().lean();
  return meta?.sdeBuildNumber ?? null;
}

// Saves the imported build number into the AppMeta document after a successful import.
async function saveBuildNumber(buildNumber: number, releaseDate: string): Promise<void> {
  await AppMeta.updateOne({}, { $set: { sdeBuildNumber: buildNumber, sdeReleaseDate: releaseDate } }, { upsert: true });
}

// ─── Name extraction ──────────────────────────────────────────────────────────

// CCP stores localized text as {"en": "Tritanium", "de": "...", ...}.
// This helper extracts the English name from that structure or a plain string.
function extractEnglishName(field: unknown): string | null {
  if (typeof field === 'string') return field;
  if (field && typeof field === 'object') {
    return (field as Record<string, string>)['en'] ?? null;
  }
  return null;
}

// ─── Import: types.jsonl → item_types ─────────────────────────────────────────

async function importTypes(stream: NodeJS.ReadableStream): Promise<void> {
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let batch: Parameters<typeof ItemType.bulkWrite>[0] = [];
  let total = 0;
  let firstLine = true;

  for await (const line of rl) {
    if (!line.trim()) continue;

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }

    // Log first record keys so field name issues are immediately visible in output
    if (firstLine) {
      console.log(`  [types.jsonl] First record keys: ${Object.keys(raw).join(', ')}`);
      firstLine = false;
    }

    // ID is stored as `_key` in the September 2025 JSONL SDE (no `typeID` field)
    const typeId = raw['_key'] as number | undefined;
    const typeName = extractEnglishName(raw['name']);

    if (!typeId || !typeName) continue;

    batch.push({
      updateOne: {
        filter: { typeId },
        update: {
          $set: {
            typeId,
            typeName,
            marketGroupId: (raw['marketGroupID'] as number) ?? null,
            volume: (raw['volume'] as number) ?? 0,
            published: (raw['published'] as boolean) ?? true,
          },
        },
        upsert: true,
      },
    });

    if (batch.length >= BATCH_SIZE) {
      await ItemType.bulkWrite(batch.splice(0, BATCH_SIZE), { ordered: false });
      total += BATCH_SIZE;
      process.stdout.write(`\r  item_types: ${total} upserted...`);
    }
  }

  if (batch.length > 0) {
    await ItemType.bulkWrite(batch, { ordered: false });
    total += batch.length;
  }

  console.log(`\r  item_types: ${total} total.          `);
}

// ─── Import: blueprints.jsonl → blueprints ────────────────────────────────────

async function importBlueprints(stream: NodeJS.ReadableStream): Promise<void> {
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let batch: Parameters<typeof Blueprint.bulkWrite>[0] = [];
  let total = 0;
  let firstLine = true;

  for await (const line of rl) {
    if (!line.trim()) continue;

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }

    if (firstLine) {
      console.log(`  [blueprints.jsonl] First record keys: ${Object.keys(raw).join(', ')}`);
      firstLine = false;
    }

    // blueprints.jsonl has BOTH `_key` and `blueprintTypeID` — we use `blueprintTypeID`
    const blueprintTypeId = raw['blueprintTypeID'] as number | undefined;
    const activities = raw['activities'] as Record<string, unknown> | undefined;
    if (!blueprintTypeId || !activities) continue;

    for (const [actName, actData] of Object.entries(activities)) {
      const activityId = RELEVANT_ACTIVITIES[actName];
      if (activityId === undefined) continue; // skip research/copying

      const act = actData as Record<string, unknown>;
      const rawMats = (act['materials'] as Array<Record<string, unknown>>) ?? [];
      const rawProds = (act['products'] as Array<Record<string, unknown>>) ?? [];

      const materials = rawMats.map((m) => ({
        typeId: m['typeID'] as number,
        quantity: m['quantity'] as number,
      }));

      const products = rawProds.map((p) => {
        const prob = p['probability'] as number | undefined;
        return {
          typeId: p['typeID'] as number,
          quantity: p['quantity'] as number,
          ...(prob !== undefined && { probability: prob }),
        };
      });

      batch.push({
        updateOne: {
          filter: { blueprintTypeId, activityId },
          update: {
            $set: {
              blueprintTypeId,
              activityId,
              time: (act['time'] as number) ?? 0,
              materials,
              products,
            },
          },
          upsert: true,
        },
      });

      if (batch.length >= BATCH_SIZE) {
        await Blueprint.bulkWrite(batch.splice(0, BATCH_SIZE), { ordered: false });
        total += BATCH_SIZE;
        process.stdout.write(`\r  blueprints: ${total} upserted...`);
      }
    }
  }

  if (batch.length > 0) {
    await Blueprint.bulkWrite(batch, { ordered: false });
    total += batch.length;
  }

  console.log(`\r  blueprints: ${total} total.          `);
}

// ─── Import: npcCorporations.jsonl → lp_store_rates ──────────────────────────

async function importNpcCorps(stream: NodeJS.ReadableStream): Promise<void> {
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let batch: Parameters<typeof LpStoreRate.bulkWrite>[0] = [];
  let total = 0;
  let firstLine = true;

  for await (const line of rl) {
    if (!line.trim()) continue;

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }

    if (firstLine) {
      console.log(`  [npcCorporations.jsonl] First record keys: ${Object.keys(raw).join(', ')}`);
      firstLine = false;
    }

    // Skip soft-deleted corporations
    if (raw['deleted'] === true) continue;

    // ID is stored as `_key` (no `corporationID` field in the new JSONL format)
    const corporationId = raw['_key'] as number | undefined;
    if (!corporationId) continue;

    // `name` is a localized object {"en": "Blood Raiders", ...}
    const corporationName =
      extractEnglishName(raw['name']) ?? `Corporation ${corporationId}`;

    batch.push({
      updateOne: {
        filter: { corporationId },
        update: {
          // $set updates the name on every import (keeps names current after patches)
          $set: { corporationName },
          // $setOnInsert only runs when creating a new document — preserves user's ISK/LP rate on re-imports
          $setOnInsert: {
            corporationId,
            iskPerLp: null,
          },
        },
        upsert: true,
      },
    });

    if (batch.length >= BATCH_SIZE) {
      await LpStoreRate.bulkWrite(batch.splice(0, BATCH_SIZE), { ordered: false });
      total += BATCH_SIZE;
    }
  }

  if (batch.length > 0) {
    await LpStoreRate.bulkWrite(batch, { ordered: false });
    total += batch.length;
  }

  console.log(`  lp_store_rates: ${total} NPC corporations seeded.`);
}

// ─── File processing targets ──────────────────────────────────────────────────

// Maps each JSONL filename to its import handler.
// Files are at the ZIP ROOT — no `fsd/` prefix in the September 2025 JSONL SDE.
const TARGETS = [
  { file: 'types.jsonl', handler: importTypes },
  { file: 'blueprints.jsonl', handler: importBlueprints },
  { file: 'npcCorporations.jsonl', handler: importNpcCorps },
] as const;

// ─── Import from local path ───────────────────────────────────────────────────

// Reads JSONL files directly from a local folder on disk.
// This is used when LOCAL_SDE_PATH is set — skips the download entirely.
async function importFromLocalPath(localPath: string): Promise<void> {
  console.log(`Reading SDE from local path: ${localPath}`);

  for (const { file, handler } of TARGETS) {
    const filePath = path.join(localPath, file);

    if (!fs.existsSync(filePath)) {
      console.warn(`  WARNING: ${filePath} not found, skipping.`);
      continue;
    }

    console.log(`\nProcessing ${file}...`);
    await handler(fs.createReadStream(filePath));
  }
}

// ─── Download + import from zip ───────────────────────────────────────────────

async function downloadSdeZip(): Promise<string> {
  const tempPath = path.join(os.tmpdir(), 'eve-sde-latest.zip');

  console.log('Downloading SDE zip from CCP...');
  console.log(`  URL: ${config.data.sdeUrl}`);
  console.log(`  Saving to: ${tempPath}`);
  console.log('  (This can take several minutes — the file is several hundred MB)');

  const response = await axios.get<NodeJS.ReadableStream>(config.data.sdeUrl, {
    responseType: 'stream',
    headers: { 'User-Agent': config.esi.userAgent },
    timeout: 600_000,
  });

  await pipeline(response.data, fs.createWriteStream(tempPath));

  const sizeMb = (fs.statSync(tempPath).size / 1024 / 1024).toFixed(1);
  console.log(`  Download complete. File size: ${sizeMb} MB`);
  return tempPath;
}

async function importFromZip(zipPath: string): Promise<void> {
  console.log('\nOpening zip file...');
  const zip = await unzipper.Open.file(zipPath);
  console.log(`ZIP contains ${zip.files.length} files.`);

  for (const { file, handler } of TARGETS) {
    const entry = zip.files.find((f) => f.path === file);

    if (!entry) {
      // Help diagnose path issues if the zip structure changes in a future SDE release
      const available = zip.files.map((f) => f.path).slice(0, 30);
      console.warn(`\nWARNING: ${file} not found in zip.`);
      console.warn(`Available entries (first 30): ${available.join(', ')}`);
      continue;
    }

    console.log(`\nProcessing ${file}...`);
    await handler(entry.stream());
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface ImportSdeOptions {
  // When true, re-imports even if the stored build number matches the latest.
  // Controlled by SDE_FORCE=1 env var in the CLI script.
  force?: boolean;
}

// Downloads (or reads locally) the SDE and imports types, blueprints, and NPC corps.
// Skips the import if the stored build number matches the latest, unless force=true.
// All writes are upserts — safe to re-run after patches.
export async function importSde(options: ImportSdeOptions = {}): Promise<void> {
  // ── 1. Get the build number we're about to import ──
  console.log('Checking SDE version...');
  const latest = await getLatestBuildInfo();
  console.log(`  Latest build: ${latest.buildNumber} (${latest.releaseDate})`);

  // ── 2. Compare with what's already in the database ──
  const stored = await getStoredBuildNumber();

  if (stored !== null) {
    console.log(`  Stored build: ${stored}`);
  } else {
    console.log(`  Stored build: none (first import)`);
  }

  if (stored === latest.buildNumber && !options.force) {
    console.log(`\nSDE is already at build ${latest.buildNumber}. Nothing to do.`);
    console.log('To re-import anyway: SDE_FORCE=1 npm run import:sde');
    return;
  }

  if (stored !== null && stored !== latest.buildNumber) {
    console.log(`\nSDE update detected: build ${stored} → ${latest.buildNumber}`);
  } else if (stored === null) {
    console.log(`\nStarting first SDE import. Build: ${latest.buildNumber}`);
  } else {
    console.log(`\nForce re-importing build ${latest.buildNumber}...`);
  }

  // ── 3. Import from local path or download the zip ──
  const localPath = config.data.localSdePath;

  if (localPath) {
    await importFromLocalPath(localPath);
  } else {
    const zipPath = await downloadSdeZip();
    try {
      await importFromZip(zipPath);
    } finally {
      fs.unlink(zipPath, () => {});
      console.log('\nTemp zip file deleted.');
    }
  }

  // ── 4. Save the new build number ──
  await saveBuildNumber(latest.buildNumber, latest.releaseDate);
  console.log(`\nSaved build number ${latest.buildNumber} to settings.`);
}
