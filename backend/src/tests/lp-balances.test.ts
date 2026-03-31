// lp-balances.test.ts
// Tests for per-account LP balance endpoints (GET and PUT).
// LP balances are scoped to the logged-in account via session.accountId.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { seedLpCorp, loginAgent, TEST_CORP_ID } from './seed';

// Mock the SSO service so login works without real CCP calls
vi.mock('../services/sso.service', async () => (await import('./seed')).createSsoMock());

const app = createApp();

let agent: ReturnType<typeof request.agent>;

beforeEach(async () => {
  vi.clearAllMocks();

  const auth = await loginAgent(app);
  agent = auth.agent;

  // Seed SDE seed row (accountId=null) — needed for corp name lookup in PUT
  await seedLpCorp();
});

describe('GET /api/lp-balances', () => {
  it('returns 401 when not logged in', async () => {
    const res = await request(app).get('/api/lp-balances');
    expect(res.status).toBe(401);
  });

  it('returns empty array when no balances entered', async () => {
    const res = await agent.get('/api/lp-balances');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns balances after one is set', async () => {
    await agent
      .put(`/api/lp-balances/${TEST_CORP_ID}`)
      .send({ currentLp: 50_000 });
    const res = await agent.get('/api/lp-balances');
    expect(res.body.length).toBe(1);
    expect(res.body[0].currentLp).toBe(50_000);
  });
});

describe('PUT /api/lp-balances/:corporationId', () => {
  it('returns 401 when not logged in', async () => {
    const res = await request(app)
      .put(`/api/lp-balances/${TEST_CORP_ID}`)
      .send({ currentLp: 75_000 });
    expect(res.status).toBe(401);
  });

  it('creates a balance record on first use (upsert)', async () => {
    const res = await agent
      .put(`/api/lp-balances/${TEST_CORP_ID}`)
      .send({ currentLp: 75_000 });
    expect(res.status).toBe(200);
    expect(res.body.corporationId).toBe(TEST_CORP_ID);
    expect(res.body.currentLp).toBe(75_000);
  });

  it('updates an existing balance', async () => {
    await agent.put(`/api/lp-balances/${TEST_CORP_ID}`).send({ currentLp: 10_000 });
    const res = await agent.put(`/api/lp-balances/${TEST_CORP_ID}`).send({ currentLp: 20_000 });
    expect(res.body.currentLp).toBe(20_000);
  });

  it('can set balance to null (clear it)', async () => {
    await agent.put(`/api/lp-balances/${TEST_CORP_ID}`).send({ currentLp: 50_000 });
    const res = await agent.put(`/api/lp-balances/${TEST_CORP_ID}`).send({ currentLp: null });
    expect(res.status).toBe(200);
    expect(res.body.currentLp).toBeNull();
  });

  it('includes the corporation name from lp_store_rates', async () => {
    const res = await agent
      .put(`/api/lp-balances/${TEST_CORP_ID}`)
      .send({ currentLp: 1000 });
    expect(res.body.corporationName).toBe('Test Corporation');
  });

  it('returns 400 for negative currentLp', async () => {
    const res = await agent
      .put(`/api/lp-balances/${TEST_CORP_ID}`)
      .send({ currentLp: -1 });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown corporation', async () => {
    const res = await agent
      .put('/api/lp-balances/9999999')
      .send({ currentLp: 1000 });
    expect(res.status).toBe(404);
  });
});
