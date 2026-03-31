// esi.service.ts
// Custom axios-based client for the EVE ESI API.
//
// Why custom instead of a library?
//   The @lgriffin/esi.ts library was rejected due to transitive dependency vulnerabilities.
//   This client is thin, zero-dependency beyond axios, and does exactly what we need.
//
// What it does:
//   - Adds datasource=tranquility and User-Agent to every request
//   - Respects CCP's Expires header: skips requests entirely when cache is still fresh
//   - ETag caching: sends If-None-Match; on 304, returns cached data without re-downloading
//   - Paginated fetching: reads X-Pages header and fetches all pages in parallel
//   - syncMarketOrders(): fetches all orders for a region and upserts to market_orders
//   - syncLpOffers():     fetches LP store offers for every NPC corp and upserts to lp_offers
//
// CCP cache compliance (https://developers.eveonline.com/docs/services/esi/best-practices/):
//   1. Do NOT re-request before the Expires header time (can result in bans)
//   2. Use ETags (If-None-Match) for conditional requests after cache expires
//   3. Store ETags independently from cache expiry
//
// To handle clock skew between our server and CCP's, we compute a relative TTL:
//   ttlMs = Date.parse(Expires) - Date.parse(Date header)
//   cacheUntil = Date.now() + ttlMs

import axios, { AxiosError } from 'axios';
import { config } from '../config';
import { MarketOrder } from '../models/market-order.model';
import { LpOffer } from '../models/lp-offer.model';
import { LpStoreRate } from '../models/lp-store-rate.model';

// ─── Constants ────────────────────────────────────────────────────────────────

const ESI_BASE = 'https://esi.evetech.net/latest';

import { BATCH_SIZE, LP_SYNC_BATCH_SIZE } from '../constants';

// ─── ESI cache ────────────────────────────────────────────────────────────────

// In-memory cache that persists for the lifetime of the server process.
// Key = full URL (including query string).
// Stores both the ETag (for conditional requests) and the Expires time
// (to skip requests entirely when CCP says the data hasn't changed yet).
interface CacheEntry {
  etag: string;
  data: unknown;
  expiresAt: number;  // Date.now()-based timestamp when cache expires (0 = unknown)
}

const esiCache = new Map<string, CacheEntry>();

/**
 * Parse the Expires and Date headers from an ESI response to compute
 * a local expiry timestamp. Uses relative TTL to handle clock skew.
 */
function parseExpiry(headers: Record<string, unknown>): number {
  const expiresStr = headers['expires'] as string | undefined;
  const dateStr = headers['date'] as string | undefined;
  if (!expiresStr) return 0;

  const expiresMs = Date.parse(expiresStr);
  if (isNaN(expiresMs)) return 0;

  // Use relative TTL to avoid clock skew issues
  const dateMs = dateStr ? Date.parse(dateStr) : Date.now();
  if (isNaN(dateMs)) return Date.now();

  const ttlMs = expiresMs - dateMs;
  return Date.now() + Math.max(ttlMs, 0);
}

/**
 * Build a cache key from URL + params (excluding the `page` param for paginated endpoints).
 */
function buildCacheKey(url: string, params: Record<string, unknown>, excludePage = false): string {
  const entries = Object.entries(params)
    .filter(([k]) => !(excludePage && k === 'page'))
    .map(([k, v]) => [k, String(v)] as [string, string]);
  return `${url}?${new URLSearchParams(entries).toString()}`;
}

// ─── Core GET helper ──────────────────────────────────────────────────────────

// Makes a single ESI GET request with Expires + ETag caching.
// 1. If cache is fresh (Expires not reached) → return cached data immediately
// 2. If cache is stale → send If-None-Match; on 304, return cached data
// 3. On 200 → store new data, ETag, and Expires time
async function esiGet<T>(path: string, params: Record<string, unknown> = {}): Promise<T> {
  const url = `${ESI_BASE}${path}`;
  const fullParams = { datasource: 'tranquility', ...params };
  const cacheKey = buildCacheKey(url, fullParams);

  const cached = esiCache.get(cacheKey);

  // If cache is still fresh per CCP's Expires header, skip the request entirely
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data as T;
  }

  const headers: Record<string, string> = {
    'User-Agent': config.esi.userAgent,
    'Accept': 'application/json',
  };
  if (cached) {
    headers['If-None-Match'] = cached.etag;
  }

  const response = await axios.get<T>(url, {
    params: fullParams,
    headers,
    timeout: 30_000,
    validateStatus: (status) => status === 200 || status === 304,
  });

  const expiresAt = parseExpiry(response.headers);

  if (response.status === 304 && cached) {
    // Data unchanged — update expiry timestamp and return cached data
    cached.expiresAt = expiresAt;
    return cached.data as T;
  }

  // 200 — store response with ETag and Expires
  const etag = response.headers['etag'] as string | undefined;
  if (etag) {
    esiCache.set(cacheKey, { etag, data: response.data, expiresAt });
  }

  return response.data;
}

// ─── Paginated GET helper ─────────────────────────────────────────────────────

// Fetches a paginated ESI endpoint and returns all items as a single flat array.
// ESI indicates total pages via the X-Pages response header.
// Caches the full merged result using page 1's Expires header as the expiry.
async function esiGetPaginated<T>(
  path: string,
  params: Record<string, unknown> = {}
): Promise<T[]> {
  const url = `${ESI_BASE}${path}`;
  const fullParams = { datasource: 'tranquility', page: 1, ...params };

  // Cache key excludes the `page` param so all pages share one expiry
  const cacheKey = buildCacheKey(url, fullParams, true) + ':paginated';
  const cached = esiCache.get(cacheKey);

  // If the full paginated result is still fresh, return it immediately
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data as T[];
  }

  const defaultHeaders = {
    'User-Agent': config.esi.userAgent,
    'Accept': 'application/json',
  };

  // Page 1 — also tells us how many total pages exist via X-Pages header
  const firstResponse = await axios.get<T[]>(url, {
    params: fullParams,
    headers: defaultHeaders,
    timeout: 30_000,
  });

  const totalPages = parseInt(firstResponse.headers['x-pages'] ?? '1', 10);
  const allData: T[] = [...firstResponse.data];

  if (totalPages > 1) {
    // Fetch pages 2..N in parallel
    const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
    const pageResults = await Promise.all(
      remainingPages.map((page) =>
        axios
          .get<T[]>(url, {
            params: { ...fullParams, page },
            headers: defaultHeaders,
            timeout: 30_000,
          })
          .then((r) => r.data)
      )
    );

    for (const pageData of pageResults) {
      allData.push(...pageData);
    }
  }

  // Cache the full merged result using page 1's Expires header
  const expiresAt = parseExpiry(firstResponse.headers);
  const etag = firstResponse.headers['etag'] as string || '';
  esiCache.set(cacheKey, { etag, data: allData, expiresAt });

  return allData;
}

// ─── Authenticated GET helper ─────────────────────────────────────────────────

// Makes a single authenticated ESI GET request with Expires + ETag caching.
// Same as esiGet but adds the Authorization: Bearer header.
export async function esiAuthGet<T>(
  path: string,
  accessToken: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  const url = `${ESI_BASE}${path}`;
  const fullParams = { datasource: 'tranquility', ...params };
  const cacheKey = buildCacheKey(url, fullParams);

  const cached = esiCache.get(cacheKey);

  // If cache is still fresh per CCP's Expires header, skip the request
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data as T;
  }

  const headers: Record<string, string> = {
    'User-Agent': config.esi.userAgent,
    'Accept': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
  };
  if (cached) {
    headers['If-None-Match'] = cached.etag;
  }

  const response = await axios.get<T>(url, {
    params: fullParams,
    headers,
    timeout: 30_000,
    validateStatus: (status) => status === 200 || status === 304,
  });

  const expiresAt = parseExpiry(response.headers);

  if (response.status === 304 && cached) {
    cached.expiresAt = expiresAt;
    return cached.data as T;
  }

  const etag = response.headers['etag'] as string | undefined;
  if (etag) {
    esiCache.set(cacheKey, { etag, data: response.data, expiresAt });
  }

  return response.data;
}

// ─── Authenticated Paginated GET helper ──────────────────────────────────────

// Fetches a paginated authenticated ESI endpoint (X-Pages based).
// Same as esiGetPaginated but with Bearer token.
// Caches the full merged result using page 1's Expires header.
export async function esiAuthGetPaginated<T>(
  path: string,
  accessToken: string,
  params: Record<string, unknown> = {}
): Promise<T[]> {
  const url = `${ESI_BASE}${path}`;
  const fullParams = { datasource: 'tranquility', page: 1, ...params };

  // Cache key excludes `page` so all pages share one expiry
  const cacheKey = buildCacheKey(url, fullParams, true) + ':auth-paginated';
  const cached = esiCache.get(cacheKey);

  // Return cached result if still fresh
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data as T[];
  }

  const authHeaders = {
    'User-Agent': config.esi.userAgent,
    'Accept': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
  };

  const firstResponse = await axios.get<T[]>(url, {
    params: fullParams,
    headers: authHeaders,
    timeout: 30_000,
  });

  const totalPages = parseInt(firstResponse.headers['x-pages'] ?? '1', 10);
  const allData: T[] = [...firstResponse.data];

  if (totalPages > 1) {
    const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
    const pageResults = await Promise.all(
      remainingPages.map((page) =>
        axios
          .get<T[]>(url, {
            params: { ...fullParams, page },
            headers: authHeaders,
            timeout: 30_000,
          })
          .then((r) => r.data)
      )
    );

    for (const pageData of pageResults) {
      allData.push(...pageData);
    }
  }

  // Cache the full merged result
  const expiresAt = parseExpiry(firstResponse.headers);
  const etag = firstResponse.headers['etag'] as string || '';
  esiCache.set(cacheKey, { etag, data: allData, expiresAt });

  return allData;
}

// ─── Authenticated Cursor-based GET helper ───────────────────────────────────

// ESI cursor pagination uses opaque before/after tokens (not numeric IDs).
// - Initial fetch: no params → returns most recent records
// - Walk backwards: use returned `before` token to get older records
// - Incremental sync: use stored `after` token to get new/updated records
// - Records ordered by last modified (most recent last)
// - Duplicates possible on updates — callers should upsert
//
// Cache compliance: for incremental syncs (afterToken provided), we cache the
// endpoint's Expires time. If the cache is still fresh, we return an empty result
// (no new data since last check). The caller's stored afterToken remains valid.

export interface CursorResult<T> {
  items: T[];
  beforeToken?: string;
  afterToken?: string;
}

export async function esiAuthGetCursor<T>(
  path: string,
  accessToken: string,
  opts: { limit?: number; afterToken?: string; beforeToken?: string; maxPages?: number } = {}
): Promise<CursorResult<T>> {
  const { limit = 1000, afterToken, beforeToken, maxPages = 50 } = opts;
  const url = `${ESI_BASE}${path}`;

  // For incremental syncs, check if the endpoint's cache is still fresh.
  // If so, CCP says there's no new data — return empty result.
  if (afterToken) {
    const cacheKey = `${url}?datasource=tranquility:cursor`;
    const cached = esiCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { items: [], afterToken };
    }
  }

  const authHeaders = {
    'User-Agent': config.esi.userAgent,
    'Accept': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
  };

  const allItems: T[] = [];
  let currentBefore = beforeToken;
  let currentAfter = afterToken;
  let firstBeforeToken: string | undefined;
  let lastAfterToken: string | undefined;
  let firstPageExpiresAt = 0;
  const walkingForward = !!afterToken;

  for (let page = 0; page < maxPages; page++) {
    const params: Record<string, unknown> = {
      datasource: 'tranquility',
      limit,
    };
    if (walkingForward && currentAfter) {
      params['after'] = currentAfter;
    } else if (currentBefore) {
      params['before'] = currentBefore;
    }

    const response = await axios.get<T[]>(url, {
      params,
      headers: authHeaders,
      timeout: 30_000,
    });

    const items = response.data;

    // Track the first page's Expires for cache
    if (page === 0) {
      firstPageExpiresAt = parseExpiry(response.headers);
    }

    if (items.length === 0) break;

    allItems.push(...items);

    // Extract cursor tokens from response headers
    const respBefore = response.headers['x-cursor-before'] as string | undefined;
    const respAfter = response.headers['x-cursor-after'] as string | undefined;

    // Track tokens for the caller
    if (page === 0 && respBefore) firstBeforeToken = respBefore;
    if (respAfter) lastAfterToken = respAfter;

    if (walkingForward) {
      // Walking forwards — continue with new after token
      if (respAfter) {
        currentAfter = respAfter;
      } else {
        break;
      }
    } else {
      // Walking backwards or first fetch — continue with new before token
      if (respBefore) {
        currentBefore = respBefore;
      } else {
        break;
      }
      // On initial fetch (no tokens provided), stop after first page
      // The caller will use the returned before token to walk further if needed
      if (!beforeToken && !afterToken) break;
    }
  }

  // Store the Expires time so subsequent calls within the cache window are skipped
  if (firstPageExpiresAt > 0) {
    const cacheKey = `${url}?datasource=tranquility:cursor`;
    esiCache.set(cacheKey, { etag: '', data: null, expiresAt: firstPageExpiresAt });
  }

  return {
    items: allItems,
    beforeToken: firstBeforeToken,
    afterToken: lastAfterToken,
  };
}

// ─── ESI response types ───────────────────────────────────────────────────────

interface EsiOrder {
  order_id: number;
  type_id: number;
  location_id: number;
  volume_total: number;
  volume_remain: number;
  min_volume: number;
  price: number;
  is_buy_order: boolean;
  duration: number;
  issued: string;
  range: string;
}

interface EsiLpOffer {
  offer_id: number;
  type_id: number;
  quantity: number;
  lp_cost: number;
  isk_cost: number;
  required_items: Array<{ type_id: number; quantity: number }>;
}

// ─── Market order sync ────────────────────────────────────────────────────────

// Fetches all live market orders for a region from ESI and upserts them into
// the market_orders collection. Stale orders (filled/cancelled since last sync)
// are deleted by comparing snapshotTime.
export async function syncMarketOrders(regionId: number): Promise<number> {
  console.log(`[ESI] Syncing market orders for region ${regionId}...`);

  const orders = await esiGetPaginated<EsiOrder>(
    `/markets/${regionId}/orders/`,
    { order_type: 'all' }
  );

  const snapshotTime = new Date();
  let batch: Parameters<typeof MarketOrder.bulkWrite>[0] = [];
  let total = 0;

  for (const order of orders) {
    batch.push({
      updateOne: {
        filter: { orderId: order.order_id },
        update: {
          $set: {
            orderId: order.order_id,
            typeId: order.type_id,
            regionId,
            locationId: order.location_id,
            price: order.price,
            volumeRemain: order.volume_remain,
            volumeTotal: order.volume_total,
            isBuyOrder: order.is_buy_order,
            issued: new Date(order.issued),
            duration: order.duration,
            minVolume: order.min_volume,
            range: order.range,
            snapshotTime,
          },
        },
        upsert: true,
      },
    });

    if (batch.length >= BATCH_SIZE) {
      await MarketOrder.bulkWrite(batch.splice(0, BATCH_SIZE), { ordered: false });
      total += BATCH_SIZE;
    }
  }

  if (batch.length > 0) {
    await MarketOrder.bulkWrite(batch, { ordered: false });
    total += batch.length;
  }

  // Delete stale orders for this region (filled/cancelled since we fetched)
  const deleteResult = await MarketOrder.deleteMany({
    regionId,
    snapshotTime: { $lt: snapshotTime },
  });

  console.log(
    `[ESI] Market orders synced: ${total} upserted, ${deleteResult.deletedCount} stale deleted.`
  );
  return total;
}

// ─── LP offer sync ────────────────────────────────────────────────────────────

// Fetches LP store offers for every NPC corporation in our database and upserts
// them into the lp_offers collection.
// Not all 280 corps have LP stores — 404 means "no LP store", which we skip.
export async function syncLpOffers(): Promise<number> {
  console.log('[ESI] Syncing LP store offers...');

  // Load all corps we know about from the SDE seed
  const corps = await LpStoreRate.find({}, { corporationId: 1 }).lean();
  const corpIds = corps.map((c) => c.corporationId);

  let totalOffers = 0;
  let corpsWithStores = 0;

  // Process in batches of LP_SYNC_BATCH_SIZE to avoid opening too many connections
  for (let i = 0; i < corpIds.length; i += LP_SYNC_BATCH_SIZE) {
    const batchIds = corpIds.slice(i, i + LP_SYNC_BATCH_SIZE);

    const results = await Promise.allSettled(
      batchIds.map((corpId) =>
        esiGet<EsiLpOffer[]>(`/loyalty/stores/${corpId}/offers/`)
      )
    );

    const writeBatch: Parameters<typeof LpOffer.bulkWrite>[0] = [];

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      const corpId = batchIds[j];

      if (result.status === 'rejected') {
        const err = result.reason as AxiosError;
        const status = err.response?.status;
        if (status === 404) {
          // No LP store for this corp — expected for most NPC corps
          continue;
        }
        // Unexpected error — log but continue with other corps
        console.warn(`[ESI] LP offers for corp ${corpId}: ${err.message}`);
        continue;
      }

      corpsWithStores++;
      const offers = result.value;

      for (const offer of offers) {
        writeBatch.push({
          updateOne: {
            filter: { corporationId: corpId, offerId: offer.offer_id },
            update: {
              $set: {
                corporationId: corpId,
                offerId: offer.offer_id,
                typeId: offer.type_id,
                quantity: offer.quantity,
                lpCost: offer.lp_cost,
                iskCost: offer.isk_cost,
                requiredItems: offer.required_items.map((r) => ({
                  typeId: r.type_id,
                  quantity: r.quantity,
                })),
              },
            },
            upsert: true,
          },
        });
      }
    }

    if (writeBatch.length > 0) {
      await LpOffer.bulkWrite(writeBatch, { ordered: false });
      totalOffers += writeBatch.length;
    }

    // Small pause between batches
    if (i + LP_SYNC_BATCH_SIZE < corpIds.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log(
    `[ESI] LP offers synced: ${totalOffers} offers from ${corpsWithStores} corporations.`
  );
  return totalOffers;
}
