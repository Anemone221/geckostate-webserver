// sync.test.ts
// Tests for POST /api/sync/market and POST /api/sync/lp-offers.
//
// The ESI service is mocked — these tests verify that the route layer:
//   1. Calls the right service function
//   2. Returns the expected response shape
//   3. Propagates errors to the global error handler (→ 500)
//
// No real HTTP calls to CCP are made here.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

// vi.mock is hoisted to the top of the file by Vitest before any imports run.
// This replaces the real esi.service module with our stub for all tests in this file.
vi.mock('../services/esi.service', () => ({
  syncMarketOrders: vi.fn(),
  syncLpOffers: vi.fn(),
}));

// Import after mock declaration so we get the mocked versions.
// These are cast to vi.Mock so TypeScript allows .mockResolvedValue etc.
import * as esiService from '../services/esi.service';

const syncMarketOrders = esiService.syncMarketOrders as ReturnType<typeof vi.fn>;
const syncLpOffers    = esiService.syncLpOffers    as ReturnType<typeof vi.fn>;

const app = createApp();

// ─── POST /api/sync/market ────────────────────────────────────────────────────

describe('POST /api/sync/market', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with ok:true and ordersUpserted count', async () => {
    syncMarketOrders.mockResolvedValue(428);

    const res = await request(app).post('/api/sync/market');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, ordersUpserted: 428 });
  });

  it('calls syncMarketOrders exactly once with a region ID number', async () => {
    syncMarketOrders.mockResolvedValue(0);

    await request(app).post('/api/sync/market');

    expect(syncMarketOrders).toHaveBeenCalledTimes(1);
    expect(syncMarketOrders).toHaveBeenCalledWith(expect.any(Number));
  });

  it('returns 500 when syncMarketOrders throws an unexpected error', async () => {
    syncMarketOrders.mockRejectedValue(new Error('ESI connection refused'));

    const res = await request(app).post('/api/sync/market');

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });
});

// ─── POST /api/sync/lp-offers ─────────────────────────────────────────────────

describe('POST /api/sync/lp-offers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with ok:true and offersUpserted count', async () => {
    syncLpOffers.mockResolvedValue(32_824);

    const res = await request(app).post('/api/sync/lp-offers');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, offersUpserted: 32_824 });
  });

  it('calls syncLpOffers exactly once with no arguments', async () => {
    syncLpOffers.mockResolvedValue(0);

    await request(app).post('/api/sync/lp-offers');

    expect(syncLpOffers).toHaveBeenCalledTimes(1);
    expect(syncLpOffers).toHaveBeenCalledWith();
  });

  it('returns 500 when syncLpOffers throws an unexpected error', async () => {
    syncLpOffers.mockRejectedValue(new Error('ESI rate limited'));

    const res = await request(app).post('/api/sync/lp-offers');

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });
});
