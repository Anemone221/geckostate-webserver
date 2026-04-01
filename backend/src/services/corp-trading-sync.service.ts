// corp-trading-sync.service.ts
// Fetches corporation trading data from ESI's authenticated endpoints
// and upserts it into MongoDB.
//
// Four sync functions:
//   1. syncCorpOrders       — open market orders (X-Pages pagination)
//   2. syncCorpTransactions — wallet transactions (cursor-based pagination)
//   3. syncCorpJournal      — wallet journal entries (X-Pages pagination)
//   4. syncCorpDivisions    — wallet/hangar division names (single call)
//
// All functions require a characterId with valid ESI tokens and the
// appropriate corporation role (Accountant, Trader, Director, etc.).

import axios from 'axios';
import { getValidAccessToken } from './token.service';
import {
  esiAuthGet,
  esiAuthGetPaginated,
} from './esi.service';
import { config } from '../config';
import { CorpOrder } from '../models/corp-order.model';
import { WalletTransaction } from '../models/wallet-transaction.model';
import { WalletJournal } from '../models/wallet-journal.model';
import { CorpDivision } from '../models/corp-division.model';
import { CorpTradingSettings } from '../models/corp-trading-settings.model';
import { BATCH_SIZE } from '../constants';

// ─── ESI response types ──────────────────────────────────────────────────────

interface EsiCorpOrder {
  order_id:         number;
  type_id:          number;
  region_id:        number;
  location_id:      number;
  price:            number;
  volume_remain:    number;
  volume_total:     number;
  is_buy_order?:    boolean;
  issued:           string;
  duration:         number;
  min_volume:       number;
  range:            string;
  escrow?:          number;
  wallet_division:  number;
  issued_by:        number;   // character who placed the order
}

interface EsiWalletTransaction {
  transaction_id:  number;
  date:            string;
  type_id:         number;
  quantity:        number;
  unit_price:      number;
  client_id:       number;
  location_id:     number;
  is_buy:          boolean;
  journal_ref_id:  number;
}

interface EsiJournalEntry {
  id:               number;
  date:             string;
  ref_type:         string;
  amount?:          number;
  balance?:         number;
  first_party_id?:  number;
  second_party_id?: number;
  description?:     string;
  context_id?:      number;
  context_id_type?: string;
  reason?:          string;
}

interface EsiDivisions {
  wallet?: Array<{ division: number; name?: string }>;
  hangar?: Array<{ division: number; name?: string }>;
}

// ─── Corp Orders Sync ────────────────────────────────────────────────────────

/**
 * Fetch all open corporation market orders from ESI and upsert into MongoDB.
 * Stale orders (filled/cancelled since last sync) are deleted by snapshotTime.
 */
export async function syncCorpOrders(
  characterId: number,
  corporationId: number
): Promise<number> {
  console.log(`[CorpSync] Syncing corp orders for corp ${corporationId}...`);

  const accessToken = await getValidAccessToken(characterId);
  const orders = await esiAuthGetPaginated<EsiCorpOrder>(
    `/corporations/${corporationId}/orders/`,
    accessToken
  );

  const snapshotTime = new Date();
  const batch: Parameters<typeof CorpOrder.bulkWrite>[0] = [];
  let total = 0;

  for (const order of orders) {
    batch.push({
      updateOne: {
        filter: { orderId: order.order_id },
        update: {
          $set: {
            orderId:        order.order_id,
            corporationId,
            characterId:    order.issued_by,
            typeId:         order.type_id,
            locationId:     order.location_id,
            regionId:       order.region_id,
            price:          order.price,
            volumeRemain:   order.volume_remain,
            volumeTotal:    order.volume_total,
            isBuyOrder:     order.is_buy_order ?? false,
            issued:         new Date(order.issued),
            duration:       order.duration,
            minVolume:      order.min_volume,
            range:          order.range,
            escrow:         order.escrow ?? null,
            walletDivision: order.wallet_division,
            snapshotTime,
          },
        },
        upsert: true,
      },
    });

    if (batch.length >= BATCH_SIZE) {
      await CorpOrder.bulkWrite(batch.splice(0, BATCH_SIZE), { ordered: false });
      total += BATCH_SIZE;
    }
  }

  if (batch.length > 0) {
    await CorpOrder.bulkWrite(batch, { ordered: false });
    total += batch.length;
  }

  // Delete stale orders for this corporation
  const deleteResult = await CorpOrder.deleteMany({
    corporationId,
    snapshotTime: { $lt: snapshotTime },
  });

  console.log(
    `[CorpSync] Corp orders synced: ${total} upserted, ${deleteResult.deletedCount} stale deleted.`
  );
  return total;
}

// ─── Wallet Transactions Sync ────────────────────────────────────────────────

/**
 * Fetch corporation wallet transactions from ESI using cursor-based pagination.
 *
 * First sync: fetches most recent page, then walks backwards with `before` token
 * to collect history (up to 50 pages).
 *
 * Subsequent syncs: uses stored `afterToken` to fetch only new/updated records.
 * Duplicates are handled by upsert on the unique index.
 */
export async function syncCorpTransactions(
  characterId: number,
  corporationId: number,
  division: number
): Promise<number> {
  console.log(`[CorpSync] Syncing wallet transactions for corp ${corporationId} div ${division}...`);

  const accessToken = await getValidAccessToken(characterId);
  const path = `/corporations/${corporationId}/wallets/${division}/transactions/`;

  // Load existing per-division cursor (highest transaction_id seen) for incremental sync
  const settings = await CorpTradingSettings.findOne({ corporationId });
  const divKey = String(division);
  const lastSeenId = settings?.transactionCursors?.get(divKey) ?? undefined;

  const ESI_BASE = 'https://esi.evetech.net/latest';
  const allTransactions: EsiWalletTransaction[] = [];
  const maxPages = 200;

  // ESI wallet transactions use from_id pagination:
  //   - No from_id → returns most recent transactions
  //   - from_id=N  → returns transactions with id < N (older)
  // We always fetch the newest page first, then walk backwards.
  // On incremental syncs, we stop when we see a transaction_id <= lastSeenId.

  let fromId: number | undefined;

  for (let page = 0; page < maxPages; page++) {
    const params: Record<string, unknown> = { datasource: 'tranquility' };
    if (fromId) params['from_id'] = fromId;

    const response = await axios.get<EsiWalletTransaction[]>(
      `${ESI_BASE}${path}`,
      {
        params,
        headers: {
          'User-Agent': config.esi.userAgent,
          'Accept': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        timeout: 30_000,
      }
    );

    const items = response.data;
    if (items.length === 0) break;

    // On incremental sync, stop when we reach already-seen transactions
    if (lastSeenId) {
      const newItems = items.filter((tx: EsiWalletTransaction) => tx.transaction_id > Number(lastSeenId));
      allTransactions.push(...newItems);
      if (newItems.length < items.length) break;
    } else {
      allTransactions.push(...items);
    }

    // Use lowest transaction_id as from_id for next page (walk backwards)
    const lowestId = Math.min(...items.map((tx: EsiWalletTransaction) => tx.transaction_id));
    fromId = lowestId;
  }

  // Upsert all transactions
  const batch: Parameters<typeof WalletTransaction.bulkWrite>[0] = [];
  let total = 0;

  for (const tx of allTransactions) {
    batch.push({
      updateOne: {
        filter: { transactionId: tx.transaction_id, corporationId, division },
        update: {
          $set: {
            transactionId: tx.transaction_id,
            corporationId,
            division,
            date:         new Date(tx.date),
            typeId:       tx.type_id,
            quantity:     tx.quantity,
            unitPrice:    tx.unit_price,
            clientId:     tx.client_id,
            locationId:   tx.location_id,
            isBuy:        tx.is_buy,
            journalRefId: tx.journal_ref_id,
          },
        },
        upsert: true,
      },
    });

    if (batch.length >= BATCH_SIZE) {
      await WalletTransaction.bulkWrite(batch.splice(0, BATCH_SIZE), { ordered: false });
      total += BATCH_SIZE;
    }
  }

  if (batch.length > 0) {
    await WalletTransaction.bulkWrite(batch, { ordered: false });
    total += batch.length;
  }

  // Store the highest transaction_id as cursor for next incremental sync
  if (allTransactions.length > 0 && settings) {
    const highestId = Math.max(...allTransactions.map(tx => tx.transaction_id));
    if (!settings.transactionCursors) {
      settings.transactionCursors = new Map();
    }
    const prev = Number(settings.transactionCursors.get(divKey) ?? 0);
    if (highestId > prev) {
      settings.transactionCursors.set(divKey, String(highestId));
      settings.markModified('transactionCursors');
      await settings.save();
    }
  }

  console.log(`[CorpSync] Wallet transactions synced: ${total} upserted.`);
  return total;
}

// ─── Wallet Journal Sync ─────────────────────────────────────────────────────

/**
 * Fetch corporation wallet journal entries from ESI (X-Pages pagination).
 * Journal entries are immutable so we only need to insert new ones.
 */
export async function syncCorpJournal(
  characterId: number,
  corporationId: number,
  division: number
): Promise<number> {
  console.log(`[CorpSync] Syncing wallet journal for corp ${corporationId} div ${division}...`);

  const accessToken = await getValidAccessToken(characterId);
  const entries = await esiAuthGetPaginated<EsiJournalEntry>(
    `/corporations/${corporationId}/wallets/${division}/journal/`,
    accessToken
  );

  const batch: Parameters<typeof WalletJournal.bulkWrite>[0] = [];
  let total = 0;

  for (const entry of entries) {
    batch.push({
      updateOne: {
        filter: { journalId: entry.id, corporationId, division },
        update: {
          $set: {
            journalId:     entry.id,
            corporationId,
            division,
            date:          new Date(entry.date),
            refType:       entry.ref_type,
            amount:        entry.amount ?? 0,
            balance:       entry.balance ?? 0,
            firstPartyId:  entry.first_party_id ?? null,
            secondPartyId: entry.second_party_id ?? null,
            description:   entry.description ?? '',
            contextId:     entry.context_id ?? null,
            contextIdType: entry.context_id_type ?? null,
            reason:        entry.reason ?? '',
          },
        },
        upsert: true,
      },
    });

    if (batch.length >= BATCH_SIZE) {
      await WalletJournal.bulkWrite(batch.splice(0, BATCH_SIZE), { ordered: false });
      total += BATCH_SIZE;
    }
  }

  if (batch.length > 0) {
    await WalletJournal.bulkWrite(batch, { ordered: false });
    total += batch.length;
  }

  console.log(`[CorpSync] Wallet journal synced: ${total} upserted.`);
  return total;
}

// ─── Corporation Divisions Sync ──────────────────────────────────────────────

/**
 * Fetch corporation division names from ESI and upsert into MongoDB.
 * This is a single (non-paginated) call.
 */
export async function syncCorpDivisions(
  characterId: number,
  corporationId: number
): Promise<void> {
  console.log(`[CorpSync] Syncing divisions for corp ${corporationId}...`);

  const accessToken = await getValidAccessToken(characterId);
  const data = await esiAuthGet<EsiDivisions>(
    `/corporations/${corporationId}/divisions/`,
    accessToken
  );

  const batch: Parameters<typeof CorpDivision.bulkWrite>[0] = [];

  // Wallet divisions
  if (data.wallet) {
    for (const div of data.wallet) {
      batch.push({
        updateOne: {
          filter: { corporationId, division: div.division, isWallet: true },
          update: {
            $set: {
              corporationId,
              division: div.division,
              name:     div.name ?? `Division ${div.division}`,
              isWallet: true,
            },
          },
          upsert: true,
        },
      });
    }
  }

  // Hangar divisions
  if (data.hangar) {
    for (const div of data.hangar) {
      batch.push({
        updateOne: {
          filter: { corporationId, division: div.division, isWallet: false },
          update: {
            $set: {
              corporationId,
              division: div.division,
              name:     div.name ?? `Division ${div.division}`,
              isWallet: false,
            },
          },
          upsert: true,
        },
      });
    }
  }

  if (batch.length > 0) {
    await CorpDivision.bulkWrite(batch, { ordered: false });
  }

  console.log(`[CorpSync] Divisions synced: ${batch.length} upserted.`);
}
