// settings.test.ts
// Tests for per-character settings endpoints (GET and PUT).
// Settings are now scoped to the logged-in character via session.characterId.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { seedSettings, loginAgent, TEST_CHARACTER_ID } from './seed';

// Mock the SSO service so login works without real CCP calls
vi.mock('../services/sso.service', async () => (await import('./seed')).createSsoMock());

const app = createApp();

let agent: ReturnType<typeof request.agent>;

beforeEach(async () => {
  vi.clearAllMocks();

  // Login first (creates account + character + default settings)
  const auth = await loginAgent(app);
  agent = auth.agent;

  // Seed test-specific settings values (overwrite the defaults from login)
  await seedSettings(TEST_CHARACTER_ID);
});

describe('GET /api/settings', () => {
  it('returns 401 when not logged in', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(401);
  });

  it('returns the settings document', async () => {
    const res = await agent.get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.brokerFeePct).toBe(0.02);
    expect(res.body.salesTaxPct).toBe(0.01);
    expect(res.body.weeklyVolumePct).toBe(0.05);
    expect(res.body.logisticsCostPerM3).toBe(0);
  });

  it('does not expose SDE build fields', async () => {
    const res = await agent.get('/api/settings');
    expect(res.body).not.toHaveProperty('sdeBuildNumber');
    expect(res.body).not.toHaveProperty('sdeReleaseDate');
  });
});

describe('PUT /api/settings', () => {
  it('returns 401 when not logged in', async () => {
    const res = await request(app)
      .put('/api/settings')
      .send({ brokerFeePct: 0.015 });
    expect(res.status).toBe(401);
  });

  it('updates a single field', async () => {
    const res = await agent
      .put('/api/settings')
      .send({ brokerFeePct: 0.015 });
    expect(res.status).toBe(200);
    expect(res.body.brokerFeePct).toBe(0.015);
    // Other fields are unchanged
    expect(res.body.salesTaxPct).toBe(0.01);
  });

  it('updates multiple fields at once', async () => {
    const res = await agent
      .put('/api/settings')
      .send({ brokerFeePct: 0.025, salesTaxPct: 0.02 });
    expect(res.status).toBe(200);
    expect(res.body.brokerFeePct).toBe(0.025);
    expect(res.body.salesTaxPct).toBe(0.02);
  });

  it('persists the update (GET after PUT)', async () => {
    await agent.put('/api/settings').send({ logisticsCostPerM3: 500 });
    const res = await agent.get('/api/settings');
    expect(res.body.logisticsCostPerM3).toBe(500);
  });

  it('returns 400 for non-numeric value', async () => {
    const res = await agent
      .put('/api/settings')
      .send({ brokerFeePct: 'not-a-number' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when no valid fields provided', async () => {
    const res = await agent
      .put('/api/settings')
      .send({ unknownField: 123 });
    expect(res.status).toBe(400);
  });

  it('ignores unknown fields', async () => {
    const res = await agent
      .put('/api/settings')
      .send({ brokerFeePct: 0.018, hackTheSystem: true });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('hackTheSystem');
  });
});
