// seed.ts
// Helper functions that insert minimal, known test data into the in-memory MongoDB.
// Tests import these to set up only the data they need.
//
// Using fixed, simple numbers makes it easy to verify calculations by hand.
// For example: lpCost=1000, sellPrice=1000000 → profit=(1000000×0.97)-500000=470000 → iskPerLp=470

import { vi } from 'vitest';
import type { Application } from 'express';
import request from 'supertest';
import { ItemType } from '../models/item-type.model';
import { Blueprint } from '../models/blueprint.model';
import { MarketOrder } from '../models/market-order.model';
import { MarketHistory } from '../models/market-history.model';
import { LpOffer } from '../models/lp-offer.model';
import { LpStoreRate } from '../models/lp-store-rate.model';
import { LpBalance } from '../models/lp-balance.model';
import { Settings } from '../models/settings.model';

// ─── Auth helpers ─────────────────────────────────────────────────────────────

// Character ID returned by the mocked SSO service in tests.
// Every test file that uses loginAgent() must mock ../services/sso.service
// with a verifyAndDecodeToken that returns this ID.
export const TEST_CHARACTER_ID = 123456789;
export const TEST_CHARACTER_NAME = 'Test Pilot';

// OAuth state string used in all test SSO mocks
export const MOCK_SSO_STATE = 'test-state-abc123';

/**
 * Returns a mock factory for ../services/sso.service.
 * Use with vi.mock('../services/sso.service', () => createSsoMock());
 */
export function createSsoMock() {
  return {
    generateState: () => MOCK_SSO_STATE,
    getAuthorizationUrl: (state: string) =>
      `https://login.eveonline.com/v2/oauth/authorize?state=${state}&client_id=test`,
    exchangeCode: vi.fn().mockResolvedValue({
      accessToken:  'mock-access-token',
      refreshToken: 'mock-refresh-token',
      expiresIn:    1200,
    }),
    verifyAndDecodeToken: vi.fn().mockReturnValue({
      characterId:   TEST_CHARACTER_ID,
      characterName: TEST_CHARACTER_NAME,
    }),
  };
}

/**
 * Returns a mock factory for ../services/token.service.
 * Use with vi.mock('../services/token.service', () => createTokenMock());
 */
export function createTokenMock() {
  return {
    getValidAccessToken: vi.fn().mockResolvedValue('mock-esi-access-token'),
  };
}

/**
 * Performs the full SSO login flow using a supertest agent.
 * The calling test file must have vi.mock('../services/sso.service', ...) set up.
 * Returns the authenticated agent plus the characterId and accountId from the session.
 */
export async function loginAgent(app: Application): Promise<{
  agent: ReturnType<typeof request.agent>;
  characterId: number;
  accountId: string;
}> {
  const agent = request.agent(app);

  // Step 1: Start login (sets oauthState in session)
  await agent.get('/api/auth/login');

  // Step 2: Callback with correct state and code (mocked SSO service)
  await agent
    .get('/api/auth/callback')
    .query({ state: 'test-state-abc123', code: 'auth-code-xyz' });

  // Step 3: Read back the session info
  const meRes = await agent.get('/api/auth/me');

  return {
    agent,
    characterId: meRes.body.characterId,
    accountId:   meRes.body.accountId,
  };
}

// ─── Default settings ─────────────────────────────────────────────────────────

// Standard settings used across most tests.
// brokerFeePct=0.02, salesTaxPct=0.01 → taxRate=0.03, (1-taxRate)=0.97
//
// Uses findOneAndUpdate+upsert so it works whether settings already exist
// (e.g. created by the auth callback on login) or not.
export async function seedSettings(characterId: number, overrides: Partial<{
  brokerFeePct: number;
  salesTaxPct: number;
  weeklyVolumePct: number;
  logisticsCostPerM3: number;
}> = {}): Promise<void> {
  await Settings.findOneAndUpdate(
    { characterId },
    {
      $set: {
        brokerFeePct:       0.02,
        salesTaxPct:        0.01,
        weeklyVolumePct:    0.05,
        logisticsCostPerM3: 0,
        ...overrides,
      },
    },
    { upsert: true },
  );
}

// ─── Items ────────────────────────────────────────────────────────────────────

// typeId 100 — the LP store output item in LP analysis tests
// typeId 101 — the required exchange item
// typeId 200 — blueprint output in manufacturing tests
// typeId 201 — blueprint material
export async function seedItems(): Promise<void> {
  await ItemType.insertMany([
    { typeId: 100, typeName: 'Test LP Output',   marketGroupId: 1000, volume: 1.0,  published: true },
    { typeId: 101, typeName: 'Test Required',    marketGroupId: null, volume: 0.1,  published: true },
    { typeId: 200, typeName: 'Test Mfg Output',  marketGroupId: 2000, volume: 10.0, published: true },
    { typeId: 201, typeName: 'Test Material',    marketGroupId: null, volume: 0.5,  published: true },
    { typeId:  34, typeName: 'Tritanium',         marketGroupId: 1857, volume: 0.01, published: true },
  ]);
}

// ─── Market orders ────────────────────────────────────────────────────────────

export const TEST_REGION = 10000002;

// Inserts a single sell order (isBuyOrder: false) — the lowest ask price.
// Tests read from sell orders for both "what you pay" and "what you sell at".
export async function seedSellOrder(typeId: number, price: number): Promise<void> {
  await MarketOrder.create({
    orderId:      typeId * 1000,   // stable, unique per typeId
    typeId,
    regionId:     TEST_REGION,
    locationId:   60003760,        // Jita 4-4
    price,
    volumeRemain: 10000,
    volumeTotal:  10000,
    isBuyOrder:   false,
    issued:       new Date(),
    duration:     90,
    minVolume:    1,
    range:        'region',
    snapshotTime: new Date(),
  });
}

// ─── Market history ───────────────────────────────────────────────────────────

// Seeds 7 days of history for a typeId with a given average daily volume.
export async function seedHistory(typeId: number, avgDailyVolume: number): Promise<void> {
  const rows = [];
  for (let i = 1; i <= 7; i++) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - i);
    date.setUTCHours(0, 0, 0, 0);
    rows.push({
      typeId,
      regionId: TEST_REGION,
      date,
      average: 1000,
      highest: 1200,
      lowest:  800,
      volume:  avgDailyVolume,
      orderCount: 50,
    });
  }
  await MarketHistory.insertMany(rows);
}

// ─── LP store data ────────────────────────────────────────────────────────────

export const TEST_CORP_ID = 1000119; // Blood Raiders

// Creates an SDE seed row (accountId=null) for a corporation.
// The iskPerLp value on seed rows is informational — account-specific rates override it.
export async function seedLpCorp(iskPerLp: number | null = null): Promise<void> {
  await LpStoreRate.create({
    corporationId:   TEST_CORP_ID,
    corporationName: 'Test Corporation',
    iskPerLp,
  });
}

// Simple LP offer: spend lpCost LP + iskCost ISK → receive quantity of typeId 100
// No required exchange items (simplest case for calculation verification).
export async function seedLpOffer(overrides: Partial<{
  lpCost: number;
  iskCost: number;
  quantity: number;
  requiredItems: Array<{ typeId: number; quantity: number }>;
}> = {}): Promise<void> {
  await LpOffer.create({
    corporationId: TEST_CORP_ID,
    offerId:       9001,
    typeId:        100,
    quantity:      1,
    lpCost:        1000,
    iskCost:       500_000,
    requiredItems: [],
    ...overrides,
  });
}

// ─── Blueprint data ───────────────────────────────────────────────────────────

// Blueprint that produces 1× typeId 200 from 10× typeId 201 in 600 seconds.
export async function seedBlueprint(): Promise<void> {
  await Blueprint.create({
    blueprintTypeId: 999,
    activityId:      1,
    time:            600,
    materials:       [{ typeId: 201, quantity: 10 }],
    products:        [{ typeId: 200, quantity: 1  }],
  });
}
