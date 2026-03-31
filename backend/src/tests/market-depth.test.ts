// market-depth.test.ts
// Verifies the order book walk endpoint returns correct cost breakdowns.
//
// Test scenario:
//   3 sell orders for typeId 100 at different prices:
//     500 ISK × 20 units, 520 ISK × 15 units, 550 ISK × 15 units
//   Total supply = 50 units
//
//   Requesting 50 units should walk all 3 orders:
//     totalCost = 20×500 + 15×520 + 15×550 = 10,000 + 7,800 + 8,250 = 26,050

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { MarketOrder } from '../models/market-order.model';
import { TEST_REGION } from './seed';

const app = createApp();

// Helper to seed multiple sell orders at different prices for a given item
async function seedSellOrders(
  typeId: number,
  orders: Array<{ price: number; volume: number }>,
): Promise<void> {
  for (let i = 0; i < orders.length; i++) {
    await MarketOrder.create({
      orderId:      typeId * 1000 + i,
      typeId,
      regionId:     TEST_REGION,
      locationId:   60003760,
      price:        orders[i]!.price,
      volumeRemain: orders[i]!.volume,
      volumeTotal:  orders[i]!.volume,
      isBuyOrder:   false,
      issued:       new Date(),
      duration:     90,
      minVolume:    1,
      range:        'region',
      snapshotTime: new Date(),
    });
  }
}

describe('GET /api/market-depth/:typeId', () => {
  beforeEach(async () => {
    await seedSellOrders(100, [
      { price: 500, volume: 20 },
      { price: 520, volume: 15 },
      { price: 550, volume: 15 },
    ]);
  });

  it('walks the full order book when quantity matches total supply', async () => {
    const res = await request(app).get('/api/market-depth/100?quantity=50');
    expect(res.status).toBe(200);
    expect(res.body.quantityRequested).toBe(50);
    expect(res.body.quantityFilled).toBe(50);
    expect(res.body.fullyFilled).toBe(true);
    expect(res.body.totalCost).toBe(26050); // 20×500 + 15×520 + 15×550
    expect(res.body.steps).toHaveLength(3);

    // Verify individual steps
    expect(res.body.steps[0]).toMatchObject({ price: 500, qtyUsed: 20, lineCost: 10000 });
    expect(res.body.steps[1]).toMatchObject({ price: 520, qtyUsed: 15, lineCost: 7800 });
    expect(res.body.steps[2]).toMatchObject({ price: 550, qtyUsed: 15, lineCost: 8250 });
  });

  it('partially fills when quantity exceeds supply', async () => {
    const res = await request(app).get('/api/market-depth/100?quantity=100');
    expect(res.status).toBe(200);
    expect(res.body.fullyFilled).toBe(false);
    expect(res.body.quantityFilled).toBe(50);
    expect(res.body.quantityRequested).toBe(100);
    expect(res.body.steps).toHaveLength(3);
  });

  it('only uses as many orders as needed', async () => {
    const res = await request(app).get('/api/market-depth/100?quantity=10');
    expect(res.status).toBe(200);
    expect(res.body.fullyFilled).toBe(true);
    expect(res.body.quantityFilled).toBe(10);
    expect(res.body.totalCost).toBe(5000); // 10 × 500
    expect(res.body.steps).toHaveLength(1);
    expect(res.body.steps[0].qtyUsed).toBe(10);
    expect(res.body.steps[0].available).toBe(20); // full volume of that order
  });

  it('calculates weighted average price', async () => {
    const res = await request(app).get('/api/market-depth/100?quantity=50');
    expect(res.body.weightedAvgPrice).toBeCloseTo(521, 0); // 26050 / 50
  });

  it('returns empty steps when no sell orders exist', async () => {
    const res = await request(app).get('/api/market-depth/999?quantity=10');
    expect(res.status).toBe(200);
    expect(res.body.steps).toHaveLength(0);
    expect(res.body.fullyFilled).toBe(false);
    expect(res.body.quantityFilled).toBe(0);
    expect(res.body.totalCost).toBe(0);
    expect(res.body.weightedAvgPrice).toBe(0);
  });

  it('returns 400 when quantity is missing', async () => {
    const res = await request(app).get('/api/market-depth/100');
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-numeric typeId', async () => {
    const res = await request(app).get('/api/market-depth/abc?quantity=10');
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-positive quantity', async () => {
    const res = await request(app).get('/api/market-depth/100?quantity=0');
    expect(res.status).toBe(400);
  });
});
