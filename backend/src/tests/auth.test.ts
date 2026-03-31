// auth.test.ts
// Tests for the CCP SSO authentication endpoints.
//
// The SSO service functions (exchangeCode, verifyAndDecodeToken) are mocked
// to avoid making real HTTP calls to CCP during tests.
//
// Tests cover: login, callback, logout, account creation, /me, /characters,
// and character switching.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { Account } from '../models/account.model';
import { Character } from '../models/character.model';
import { Settings } from '../models/settings.model';
import { loginAgent, TEST_CHARACTER_ID } from './seed';

// Mock the SSO service so tests don't call CCP's servers
vi.mock('../services/sso.service', async () => (await import('./seed')).createSsoMock());

const app = createApp();

describe('Auth endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/auth/me', () => {
    it('returns 401 when not logged in', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Not authenticated');
    });

    it('returns accountId after login', async () => {
      const { agent } = await loginAgent(app);
      const res = await agent.get('/api/auth/me');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('accountId');
      expect(typeof res.body.accountId).toBe('string');
    });
  });

  describe('GET /api/auth/login', () => {
    it('redirects to CCP SSO login page', async () => {
      const res = await request(app).get('/api/auth/login');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('login.eveonline.com');
      expect(res.headers.location).toContain('state=test-state-abc123');
    });
  });

  describe('GET /api/auth/callback', () => {
    it('returns 400 when state parameter is missing', async () => {
      const res = await request(app)
        .get('/api/auth/callback')
        .query({ code: 'some-code' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('state');
    });

    it('returns 400 when code is missing', async () => {
      // First get a session with a valid state by hitting /login
      const agent = request.agent(app);
      await agent.get('/api/auth/login');

      // Now hit callback with state but no code
      const res = await agent
        .get('/api/auth/callback')
        .query({ state: 'test-state-abc123' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('code');
    });

    it('completes login flow and redirects to frontend', async () => {
      const agent = request.agent(app);

      // Step 1: Start login (sets oauthState in session)
      await agent.get('/api/auth/login');

      // Step 2: Callback with correct state and code
      const res = await agent
        .get('/api/auth/callback')
        .query({ state: 'test-state-abc123', code: 'auth-code-xyz' });

      expect(res.status).toBe(302);
      // Should redirect to the frontend URL
      expect(res.headers.location).toContain('localhost');

      // Step 3: Verify we're now logged in
      const meRes = await agent.get('/api/auth/me');
      expect(meRes.status).toBe(200);
      expect(meRes.body.characterId).toBe(123456789);
      expect(meRes.body.characterName).toBe('Test Pilot');
    });

    it('creates an Account on first login', async () => {
      await loginAgent(app);

      const accounts = await Account.find();
      expect(accounts.length).toBe(1);
      expect(accounts[0]!.primaryCharacterId).toBe(TEST_CHARACTER_ID);
    });

    it('creates a Character linked to the Account', async () => {
      const { accountId } = await loginAgent(app);

      const char = await Character.findOne({ characterId: TEST_CHARACTER_ID });
      expect(char).not.toBeNull();
      expect(char!.accountId.toString()).toBe(accountId);
    });

    it('creates default Settings for the character', async () => {
      await loginAgent(app);

      const settings = await Settings.findOne({ characterId: TEST_CHARACTER_ID });
      expect(settings).not.toBeNull();
      expect(settings!.brokerFeePct).toBeDefined();
    });
  });

  describe('POST /api/auth/logout', () => {
    it('clears the session after login', async () => {
      const { agent } = await loginAgent(app);

      // Verify logged in
      const beforeLogout = await agent.get('/api/auth/me');
      expect(beforeLogout.status).toBe(200);

      // Logout
      const logoutRes = await agent.post('/api/auth/logout');
      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.ok).toBe(true);

      // Verify logged out
      const afterLogout = await agent.get('/api/auth/me');
      expect(afterLogout.status).toBe(401);
    });
  });

  describe('GET /api/auth/characters', () => {
    it('returns 401 when not logged in', async () => {
      const res = await request(app).get('/api/auth/characters');
      expect(res.status).toBe(401);
    });

    it('returns the logged-in character', async () => {
      const { agent } = await loginAgent(app);

      const res = await agent.get('/api/auth/characters');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].characterId).toBe(TEST_CHARACTER_ID);
      expect(res.body[0].characterName).toBe('Test Pilot');
      expect(res.body[0].active).toBe(true);
    });

    it('shows multiple characters on the same account', async () => {
      const { agent, accountId } = await loginAgent(app);

      // Directly insert a second character on the same account
      await Character.create({
        characterId:   987654321,
        characterName: 'Alt Pilot',
        accountId,
        accessToken:   'mock-token-2',
        refreshToken:  'mock-refresh-2',
        tokenExpiry:   new Date(Date.now() + 3600_000),
        scopes:        ['publicData'],
      });

      const res = await agent.get('/api/auth/characters');
      expect(res.body.length).toBe(2);

      const names = res.body.map((c: { characterName: string }) => c.characterName).sort();
      expect(names).toEqual(['Alt Pilot', 'Test Pilot']);
    });
  });

  describe('PUT /api/auth/switch/:characterId', () => {
    it('returns 401 when not logged in', async () => {
      const res = await request(app).put('/api/auth/switch/123');
      expect(res.status).toBe(401);
    });

    it('switches active character', async () => {
      const { agent, accountId } = await loginAgent(app);

      const altId = 987654321;

      // Insert a second character on the same account
      await Character.create({
        characterId:   altId,
        characterName: 'Alt Pilot',
        accountId,
        accessToken:   'mock-token-2',
        refreshToken:  'mock-refresh-2',
        tokenExpiry:   new Date(Date.now() + 3600_000),
        scopes:        ['publicData'],
      });

      // Switch to the alt
      const switchRes = await agent.put(`/api/auth/switch/${altId}`);
      expect(switchRes.status).toBe(200);
      expect(switchRes.body.ok).toBe(true);
      expect(switchRes.body.characterId).toBe(altId);

      // Verify /me now returns the alt
      const meRes = await agent.get('/api/auth/me');
      expect(meRes.body.characterId).toBe(altId);
      expect(meRes.body.characterName).toBe('Alt Pilot');
    });

    it('returns 404 for a character not on this account', async () => {
      const { agent } = await loginAgent(app);

      // Try to switch to a character ID that doesn't exist
      const res = await agent.put('/api/auth/switch/999999');
      expect(res.status).toBe(404);
    });
  });
});
