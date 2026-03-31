// lp-rates.test.ts
// Tests for per-account LP rate endpoints (GET and PUT).
// LP rates are scoped to the logged-in account via session.accountId.

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

  // Seed SDE seed row (accountId=null) for the test corporation
  await seedLpCorp(null);
});

describe('GET /api/lp-rates', () => {
  it('returns 401 when not logged in', async () => {
    const res = await request(app).get('/api/lp-rates');
    expect(res.status).toBe(401);
  });

  it('returns all corporations', async () => {
    const res = await agent.get('/api/lp-rates');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
  });

  it('includes corporationId, corporationName, iskPerLp fields', async () => {
    const res = await agent.get('/api/lp-rates');
    const corp = res.body[0];
    expect(corp).toHaveProperty('corporationId');
    expect(corp).toHaveProperty('corporationName');
    expect(corp).toHaveProperty('iskPerLp');
  });

  it('iskPerLp is null when not yet set', async () => {
    const res = await agent.get('/api/lp-rates');
    expect(res.body[0].iskPerLp).toBeNull();
  });
});

describe('PUT /api/lp-rates/:corporationId', () => {
  it('returns 401 when not logged in', async () => {
    const res = await request(app)
      .put(`/api/lp-rates/${TEST_CORP_ID}`)
      .send({ iskPerLp: 3000 });
    expect(res.status).toBe(401);
  });

  it('sets iskPerLp for a corporation', async () => {
    const res = await agent
      .put(`/api/lp-rates/${TEST_CORP_ID}`)
      .send({ iskPerLp: 3000 });
    expect(res.status).toBe(200);
    expect(res.body.iskPerLp).toBe(3000);
    expect(res.body.corporationId).toBe(TEST_CORP_ID);
  });

  it('persists the rate (GET after PUT)', async () => {
    await agent.put(`/api/lp-rates/${TEST_CORP_ID}`).send({ iskPerLp: 2500 });
    const res = await agent.get('/api/lp-rates');
    const corp = res.body.find((c: { corporationId: number }) => c.corporationId === TEST_CORP_ID);
    expect(corp.iskPerLp).toBe(2500);
  });

  it('can clear the rate by setting null', async () => {
    await agent.put(`/api/lp-rates/${TEST_CORP_ID}`).send({ iskPerLp: 3000 });
    const res = await agent.put(`/api/lp-rates/${TEST_CORP_ID}`).send({ iskPerLp: null });
    expect(res.status).toBe(200);
    expect(res.body.iskPerLp).toBeNull();
  });

  it('returns 400 for negative iskPerLp', async () => {
    const res = await agent
      .put(`/api/lp-rates/${TEST_CORP_ID}`)
      .send({ iskPerLp: -100 });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown corporation', async () => {
    const res = await agent
      .put('/api/lp-rates/9999999')
      .send({ iskPerLp: 1000 });
    expect(res.status).toBe(404);
  });

  it('returns 400 for non-numeric corporationId', async () => {
    const res = await agent
      .put('/api/lp-rates/abc')
      .send({ iskPerLp: 1000 });
    expect(res.status).toBe(400);
  });
});
