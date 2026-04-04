// corp-trading-sync.job.ts
// Cron job that syncs corporation trading data from ESI every 15 minutes.
//
// For each account that has corp trading settings configured, it:
//   1. Finds a character on that account with the required scopes
//   2. Syncs corp orders, wallet transactions, and wallet journal
//   3. Updates the sync timestamps on CorpTradingSettings
//
// Runs on the same schedule as the market sync: every 15 minutes.
// Errors are logged but don't crash the server — the job retries next cycle.

import cron from 'node-cron';
import { CorpTradingSettings } from '../models/corp-trading-settings.model';
import { Character } from '../models/character.model';
import {
  syncCorpOrders,
  syncCorpTransactions,
  syncCorpJournal,
  syncCorpDivisions,
  syncCorpIndustryJobs,
} from '../services/corp-trading-sync.service';
import { ESI_SCOPES } from '../constants';

export function startCorpTradingSyncJob(): void {
  cron.schedule('*/15 * * * *', async () => {
    console.log('[CorpTradingSync] Starting corporation trading sync...');

    try {
      // Find all accounts that have corp trading configured
      const allSettings = await CorpTradingSettings.find({}).lean();

      if (allSettings.length === 0) {
        console.log('[CorpTradingSync] No accounts have corp trading configured. Skipping.');
        return;
      }

      for (const settings of allSettings) {
        try {
          // Find a character on this account that has all required scopes
          const character = await Character.findOne({
            accountId: settings.accountId,
            scopes: { $all: [ESI_SCOPES.CORP_ORDERS, ESI_SCOPES.CORP_WALLETS] },
          }).lean();

          if (!character) {
            console.warn(
              `[CorpTradingSync] No character with required scopes for account ${settings.accountId}. Skipping.`
            );
            continue;
          }

          const corpId = settings.corporationId || character.corporationId;
          if (!corpId) {
            console.warn(
              `[CorpTradingSync] No corporation ID for account ${settings.accountId}. Skipping.`
            );
            continue;
          }

          // Sync corp orders (corp-wide, not per-division)
          await syncCorpOrders(character.characterId, corpId);

          // Sync transactions + journal for all 7 wallet divisions.
          // ESI returns empty arrays for unused divisions, so overhead is minimal.
          // The Expires cache means repeated calls within the cache window are free.
          for (let div = 1; div <= 7; div++) {
            await syncCorpTransactions(character.characterId, corpId, div);
            await syncCorpJournal(character.characterId, corpId, div);
          }

          // Sync division names
          await syncCorpDivisions(character.characterId, corpId);

          // Sync industry jobs (only if character has the scope)
          if (character.scopes.includes(ESI_SCOPES.CORP_INDUSTRY)) {
            await syncCorpIndustryJobs(character.characterId, corpId);
          }

          // Update timestamps
          const now = new Date();
          await CorpTradingSettings.updateOne(
            { _id: settings._id },
            {
              $set: {
                lastOrderSync: now,
                lastTransactionSync: now,
                lastJournalSync: now,
              },
            }
          );
        } catch (err) {
          // Log per-account errors but continue with other accounts
          console.error(
            `[CorpTradingSync] Error syncing account ${settings.accountId}:`,
            err instanceof Error ? err.message : err
          );
        }
      }

      console.log('[CorpTradingSync] Corporation trading sync complete.');
    } catch (err) {
      console.error('[CorpTradingSync] Job failed:', err instanceof Error ? err.message : err);
    }
  });

  console.log('[CorpTradingSync] Corporation trading sync scheduled (runs every 15 minutes).');
}
