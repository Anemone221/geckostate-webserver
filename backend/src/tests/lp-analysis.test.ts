// lp-analysis.test.ts
// Verifies the ISK/LP calculation maths end-to-end through the HTTP API.
//
// Test scenario (simple, hand-verifiable):
//   LP offer: lpCost=1000, iskCost=500,000, quantity=1, no required items
//   Sell price for output: 1,000,000 ISK
//   Settings: brokerFeePct=0.02, salesTaxPct=0.01 → taxRate=0.03
//
//   Expected:
//     otherCost     = 0          (no required items)
//     logisticsCost = 0          (logisticsCostPerM3=0)
//     totalCost     = 500,000
//     grossSell     = 1,000,000
//     afterTaxSell  = 1,000,000 × 0.97 = 970,000
//     profit        = 970,000 - 500,000 = 470,000
//     iskPerLp      = 470,000 / 1,000 = 470
//     minSellPrice  = 500,000 / 1 / 0.97 ≈ 515,463.92

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import {
  seedSettings, seedItems, seedSellOrder, seedHistory,
  seedLpCorp, seedLpOffer, loginAgent,
  TEST_CORP_ID, TEST_CHARACTER_ID,
} from './seed';

// Mock the SSO service so login works without real CCP calls
vi.mock('../services/sso.service', async () => (await import('./seed')).createSsoMock());

const app = createApp();

let agent: ReturnType<typeof request.agent>;

async function seedAll(): Promise<void> {
  // Login first (creates account + character + default settings)
  const auth = await loginAgent(app);
  agent = auth.agent;

  // Seed test data
  await seedSettings(TEST_CHARACTER_ID);
  await seedItems();
  await seedLpCorp();
  await seedLpOffer(); // lpCost=1000, iskCost=500000, typeId=100
  await seedSellOrder(100, 1_000_000); // output item sell price
  await seedHistory(100, 200); // 200 units avg daily volume
}

describe('GET /api/lp/:corporationId', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await seedAll();
  });

  it('returns 401 when not logged in', async () => {
    const res = await request(app).get(`/api/lp/${TEST_CORP_ID}`);
    expect(res.status).toBe(401);
  });

  it('returns 200 with an array of offers', async () => {
    const res = await agent.get(`/api/lp/${TEST_CORP_ID}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
  });

  it('calculates profit correctly', async () => {
    const res = await agent.get(`/api/lp/${TEST_CORP_ID}`);
    const offer = res.body[0];
    expect(offer.profit).toBeCloseTo(470_000, 0);
  });

  it('calculates ISK/LP correctly', async () => {
    const res = await agent.get(`/api/lp/${TEST_CORP_ID}`);
    const offer = res.body[0];
    expect(offer.iskPerLp).toBeCloseTo(470, 2);
  });

  it('calculates minimum sell price correctly', async () => {
    // minSellPrice = totalCost / qty / (1 - taxRate) = 500000 / 1 / 0.97 ≈ 515463.92
    const res = await agent.get(`/api/lp/${TEST_CORP_ID}`);
    const offer = res.body[0];
    expect(offer.minSellPrice).toBeCloseTo(515_463.92, 0);
  });

  it('calculates weekly volume and max sell units correctly', async () => {
    // avgDailyVolume=200, weeklyVolume=1400, maxWeeklySellUnits=1400×0.05=70
    const res = await agent.get(`/api/lp/${TEST_CORP_ID}`);
    const offer = res.body[0];
    expect(offer.weeklyVolume).toBeCloseTo(1400, 0);
    expect(offer.maxWeeklySellUnits).toBeCloseTo(70, 0);
  });

  it('includes output item name', async () => {
    const res = await agent.get(`/api/lp/${TEST_CORP_ID}`);
    expect(res.body[0].typeName).toBe('Test LP Output');
  });

  it('redemptionsAvailable is null when no LP balance set', async () => {
    const res = await agent.get(`/api/lp/${TEST_CORP_ID}`);
    expect(res.body[0].redemptionsAvailable).toBeNull();
  });

  it('calculates redemptionsAvailable when LP balance is set', async () => {
    // 5000 LP balance / 1000 lpCost = 5 redemptions
    await agent.put(`/api/lp-balances/${TEST_CORP_ID}`).send({ currentLp: 5000 });
    const res = await agent.get(`/api/lp/${TEST_CORP_ID}`);
    expect(res.body[0].redemptionsAvailable).toBe(5);
  });

  it('handles required items in the cost calculation', async () => {
    // Add a required item to the LP offer (typeId 101, qty 2, sell price 50,000)
    // otherCost = 2 × 50,000 = 100,000
    // totalCost = 500,000 + 100,000 = 600,000
    // profit = 970,000 - 600,000 = 370,000
    // iskPerLp = 370,000 / 1000 = 370
    await seedSellOrder(101, 50_000);
    const { LpOffer } = await import('../models/lp-offer.model');
    await LpOffer.updateOne(
      { corporationId: TEST_CORP_ID, offerId: 9001 },
      { $set: { requiredItems: [{ typeId: 101, quantity: 2 }] } }
    );

    const res = await agent.get(`/api/lp/${TEST_CORP_ID}`);
    const offer = res.body[0];
    expect(offer.otherCost).toBeCloseTo(100_000, 0);
    expect(offer.totalCost).toBeCloseTo(600_000, 0);
    expect(offer.profit).toBeCloseTo(370_000, 0);
    expect(offer.iskPerLp).toBeCloseTo(370, 2);
  });

  it('returns profit=null when output item has no sell orders', async () => {
    const { MarketOrder } = await import('../models/market-order.model');
    await MarketOrder.deleteMany({ typeId: 100 });

    const res = await agent.get(`/api/lp/${TEST_CORP_ID}`);
    const offer = res.body[0];
    expect(offer.bestSellPrice).toBeNull();
    expect(offer.profit).toBeNull();
    expect(offer.iskPerLp).toBeNull();
  });

  it('returns empty array for a corporation with no offers', async () => {
    const { LpOffer } = await import('../models/lp-offer.model');
    await LpOffer.deleteMany({});

    const res = await agent.get(`/api/lp/${TEST_CORP_ID}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('uses the correct region for price lookups', async () => {
    // Add a sell order in a different region — should not affect the result
    const { MarketOrder } = await import('../models/market-order.model');
    await MarketOrder.create({
      orderId: 99999,
      typeId: 100,
      regionId: 10000033, // The Citadel — wrong region
      locationId: 60003760,
      price: 9_999_999, // much higher price — should be ignored
      volumeRemain: 1000,
      volumeTotal: 1000,
      isBuyOrder: false,
      issued: new Date(),
      duration: 90,
      minVolume: 1,
      range: 'region',
      snapshotTime: new Date(),
    });

    const res = await agent.get(`/api/lp/${TEST_CORP_ID}`);
    // Price should still be 1,000,000 (from The Forge), not 9,999,999
    expect(res.body[0].bestSellPrice).toBe(1_000_000);
  });

  it('returns 400 for non-numeric corporationId', async () => {
    const res = await agent.get('/api/lp/notanumber');
    expect(res.status).toBe(400);
  });

  describe('logistics cost', () => {
    it('adds logistics cost to totalCost when logisticsCostPerM3 > 0', async () => {
      // item volume=1.0 m³, qty=1, logisticsCostPerM3=1000 → logisticsCost=1000
      await agent.put('/api/settings').send({ logisticsCostPerM3: 1000 });

      const res = await agent.get(`/api/lp/${TEST_CORP_ID}`);
      const offer = res.body[0];
      expect(offer.logisticsCost).toBe(1000);
      expect(offer.totalCost).toBeCloseTo(501_000, 0);
      expect(offer.profit).toBeCloseTo(469_000, 0);
    });
  });
});

describe('GET /api/lp/corps', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    const auth = await loginAgent(app);
    agent = auth.agent;

    await seedLpCorp(1500);
    await seedLpOffer();   // endpoint filters to corps that have at least one LP offer
  });

  it('returns 401 when not logged in', async () => {
    const res = await request(app).get('/api/lp/corps');
    expect(res.status).toBe(401);
  });

  it('returns all seeded corporations', async () => {
    const res = await agent.get('/api/lp/corps');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].corporationId).toBe(TEST_CORP_ID);
  });

  it('includes iskPerLp in the response', async () => {
    const res = await agent.get('/api/lp/corps');
    expect(res.body[0].iskPerLp).toBe(1500);
  });
});
