// market-sync.job.ts
// Cron job that refreshes the market_orders collection from ESI every 15 minutes.
//
// ESI market orders update roughly every 5 minutes, but fetching all pages
// for a full region takes ~30-60 seconds. Every 15 minutes keeps data fresh
// while the ETag cache means most pages return 304 (no re-download).
//
// Schedule: '*/15 * * * *' = every 15 minutes (:00, :15, :30, :45)

import cron from 'node-cron';
import { syncMarketOrders } from '../services/esi.service';
import { config } from '../config';

export function startMarketSyncJob(): void {
  cron.schedule('*/15 * * * *', async () => {
    console.log('[MarketSync] Starting market order sync...');
    try {
      await syncMarketOrders(config.primaryRegionId);
    } catch (err) {
      // Log the error but don't crash the server — the job will retry in 15 minutes
      console.error('[MarketSync] Sync failed:', err instanceof Error ? err.message : err);
    }
  });

  console.log('[MarketSync] Market sync scheduled (runs every 15 minutes).');
}
