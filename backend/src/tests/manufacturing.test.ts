// manufacturing.test.ts
// Verifies manufacturing profit calculation end-to-end through the HTTP API.
//
// Test scenario (hand-verifiable):
//   Blueprint: 10× typeId 201 (material) → 1× typeId 200 (output), 600 seconds
//   Material sell price: 100 ISK each → materialCost = 10 × 100 = 1,000
//   Output sell price: 2,000 ISK
//   Settings: brokerFeePct=0.02, salesTaxPct=0.01 → taxRate=0.03
//
//   Expected:
//     totalMaterialCost = 1,000
//     logisticsCost     = 0
//     grossRevenue      = 2,000
//     brokerFee         = 2,000 × 0.02 = 40
//     salesTax          = 2,000 × 0.01 = 20
//     netRevenue        = 2,000 × 0.97 = 1,940
//     netProfit         = 1,940 - 1,000 = 940
//     profitPerUnit     = 940
//     profitMarginPct   = 940 / 2000 × 100 = 47%

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import {
  seedSettings, seedItems, seedSellOrder, seedBlueprint,
  loginAgent, TEST_CHARACTER_ID,
} from './seed';

// Mock the SSO service so login works without real CCP calls
vi.mock('../services/sso.service', async () => (await import('./seed')).createSsoMock());

const app = createApp();

// typeId 200 = output, typeId 201 = material (seeded in seedItems and seedBlueprint)
const OUTPUT_TYPE_ID = 200;
const MATERIAL_TYPE_ID = 201;

let agent: ReturnType<typeof request.agent>;

async function seedAll(): Promise<void> {
  // Login first (creates account + character + default settings)
  const auth = await loginAgent(app);
  agent = auth.agent;

  // Seed test data
  await seedSettings(TEST_CHARACTER_ID);
  await seedItems();
  await seedBlueprint();
  await seedSellOrder(MATERIAL_TYPE_ID, 100);    // buy material at 100 ISK
  await seedSellOrder(OUTPUT_TYPE_ID, 2_000);    // sell output at 2,000 ISK
}

describe('GET /api/manufacturing/:typeId', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await seedAll();
  });

  it('returns 401 when not logged in', async () => {
    const res = await request(app).get(`/api/manufacturing/${OUTPUT_TYPE_ID}`);
    expect(res.status).toBe(401);
  });

  it('returns 200 with a breakdown object', async () => {
    const res = await agent.get(`/api/manufacturing/${OUTPUT_TYPE_ID}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('blueprintTypeId');
    expect(res.body).toHaveProperty('materials');
    expect(res.body).toHaveProperty('netProfit');
  });

  it('returns correct blueprint metadata', async () => {
    const res = await agent.get(`/api/manufacturing/${OUTPUT_TYPE_ID}`);
    expect(res.body.blueprintTypeId).toBe(999);
    expect(res.body.activityId).toBe(1);
    expect(res.body.buildTimeSeconds).toBe(600);
    expect(res.body.outputQuantity).toBe(1);
  });

  it('calculates total material cost correctly', async () => {
    const res = await agent.get(`/api/manufacturing/${OUTPUT_TYPE_ID}`);
    // 10 × 100 = 1,000
    expect(res.body.totalMaterialCost).toBeCloseTo(1_000, 0);
  });

  it('calculates gross revenue correctly', async () => {
    const res = await agent.get(`/api/manufacturing/${OUTPUT_TYPE_ID}`);
    expect(res.body.grossRevenue).toBe(2_000);
  });

  it('calculates broker fee correctly', async () => {
    const res = await agent.get(`/api/manufacturing/${OUTPUT_TYPE_ID}`);
    // 2000 × 0.02 = 40
    expect(res.body.brokerFee).toBeCloseTo(40, 2);
  });

  it('calculates sales tax correctly', async () => {
    const res = await agent.get(`/api/manufacturing/${OUTPUT_TYPE_ID}`);
    // 2000 × 0.01 = 20
    expect(res.body.salesTax).toBeCloseTo(20, 2);
  });

  it('calculates net revenue correctly', async () => {
    const res = await agent.get(`/api/manufacturing/${OUTPUT_TYPE_ID}`);
    // 2000 × 0.97 = 1940
    expect(res.body.netRevenue).toBeCloseTo(1_940, 0);
  });

  it('calculates net profit correctly', async () => {
    const res = await agent.get(`/api/manufacturing/${OUTPUT_TYPE_ID}`);
    // 1940 - 1000 = 940
    expect(res.body.netProfit).toBeCloseTo(940, 0);
  });

  it('calculates profit per unit correctly', async () => {
    const res = await agent.get(`/api/manufacturing/${OUTPUT_TYPE_ID}`);
    expect(res.body.profitPerUnit).toBeCloseTo(940, 0);
  });

  it('calculates profit margin % correctly', async () => {
    const res = await agent.get(`/api/manufacturing/${OUTPUT_TYPE_ID}`);
    // 940 / 2000 × 100 = 47%
    expect(res.body.profitMarginPct).toBeCloseTo(47, 1);
  });

  it('includes item names in material rows', async () => {
    const res = await agent.get(`/api/manufacturing/${OUTPUT_TYPE_ID}`);
    const mat = res.body.materials[0];
    expect(mat.typeName).toBe('Test Material');
    expect(mat.quantity).toBe(10);
    expect(mat.unitPrice).toBe(100);
    expect(mat.totalCost).toBe(1_000);
  });

  it('returns null revenue fields when output has no sell orders', async () => {
    const { MarketOrder } = await import('../models/market-order.model');
    await MarketOrder.deleteMany({ typeId: OUTPUT_TYPE_ID });

    const res = await agent.get(`/api/manufacturing/${OUTPUT_TYPE_ID}`);
    expect(res.body.outputSellPrice).toBeNull();
    expect(res.body.netProfit).toBeNull();
    expect(res.body.profitMarginPct).toBeNull();
  });

  it('returns null material cost when a material has no sell orders', async () => {
    const { MarketOrder } = await import('../models/market-order.model');
    await MarketOrder.deleteMany({ typeId: MATERIAL_TYPE_ID });

    const res = await agent.get(`/api/manufacturing/${OUTPUT_TYPE_ID}`);
    expect(res.body.totalMaterialCost).toBeNull();
    expect(res.body.netProfit).toBeNull();
  });

  it('applies logistics cost when logisticsCostPerM3 > 0', async () => {
    // output item volume=10 m³, qty=1, logisticsCostPerM3=50 → logisticsCost=500
    await agent.put('/api/settings').send({ logisticsCostPerM3: 50 });

    const res = await agent.get(`/api/manufacturing/${OUTPUT_TYPE_ID}`);
    expect(res.body.logisticsCost).toBe(500);
    expect(res.body.totalCost).toBeCloseTo(1_500, 0);
    expect(res.body.netProfit).toBeCloseTo(440, 0); // 1940 - 1500
  });

  it('returns 404 for an item with no blueprint', async () => {
    // typeId 34 (Tritanium) has no manufacturing blueprint
    const res = await agent.get('/api/manufacturing/34');
    expect(res.status).toBe(404);
  });

  it('returns 400 for non-numeric typeId', async () => {
    const res = await agent.get('/api/manufacturing/abc');
    expect(res.status).toBe(400);
  });
});
