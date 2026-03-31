// auth.routes.ts
// CCP SSO OAuth2 authentication endpoints.
//
// Login flow:
//   1. Browser visits GET /api/auth/login
//   2. Server generates a random state token (CSRF protection), stores it in session
//   3. Server redirects browser to CCP's login page
//   4. User authorizes the app on CCP's site
//   5. CCP redirects to GET /api/auth/callback with code + state
//   6. Server verifies state, exchanges code for tokens, handles account/character
//   7. Server sets session.characterId + session.accountId, redirects to frontend
//
// Account model:
//   - First character to log in creates a new Account
//   - If already logged in (session.accountId exists), new character joins that account
//   - If character already exists in DB, reuses its existing account
//
// After login:
//   - GET /api/auth/me          — current character + account info
//   - GET /api/auth/characters  — all characters on this account
//   - PUT /api/auth/switch/:id  — switch active character
//   - POST /api/auth/logout     — destroy session

import { Router, Request, Response } from 'express';
import axios from 'axios';
import {
  generateState,
  getAuthorizationUrl,
  exchangeCode,
  verifyAndDecodeToken,
} from '../services/sso.service';
import { Account } from '../models/account.model';
import { Character } from '../models/character.model';
import { Settings } from '../models/settings.model';
import { LpStoreRate } from '../models/lp-store-rate.model';
import { LpBalance } from '../models/lp-balance.model';
import { parsePositiveInt } from '../utils/validation';
import { config } from '../config';

const router = Router();

/**
 * One-time migration: if unscoped (legacy) data exists from before the
 * account system was added, copy it to the new account/character.
 */
async function migrateGlobalData(accountId: string, characterId: number): Promise<void> {
  // Migrate global settings (no characterId field) to the new character
  const globalSettings = await Settings.findOne({
    characterId: { $exists: false },
  }).lean();
  if (globalSettings) {
    const existing = await Settings.findOne({ characterId });
    if (!existing) {
      await Settings.create({
        characterId,
        brokerFeePct:       globalSettings.brokerFeePct,
        salesTaxPct:        globalSettings.salesTaxPct,
        weeklyVolumePct:    globalSettings.weeklyVolumePct,
        logisticsCostPerM3: globalSettings.logisticsCostPerM3,
      });
    }
    // Clean up old global records
    await Settings.deleteMany({ characterId: { $exists: false } });
  }

  // Migrate global LP rates (those with iskPerLp set and no accountId)
  const globalRates = await LpStoreRate.find({
    accountId: null,
    iskPerLp: { $ne: null },
  }).lean();
  for (const rate of globalRates) {
    await LpStoreRate.findOneAndUpdate(
      { accountId, corporationId: rate.corporationId },
      {
        $setOnInsert: {
          corporationName: rate.corporationName,
          iskPerLp: rate.iskPerLp,
        },
      },
      { upsert: true },
    );
  }

  // Migrate global LP balances (no accountId field)
  const globalBalances = await LpBalance.find({
    accountId: { $exists: false },
  }).lean();
  for (const bal of globalBalances) {
    await LpBalance.findOneAndUpdate(
      { accountId, corporationId: bal.corporationId },
      {
        $setOnInsert: {
          corporationName: bal.corporationName,
          currentLp: bal.currentLp,
        },
      },
      { upsert: true },
    );
  }
  if (globalBalances.length > 0) {
    await LpBalance.deleteMany({ accountId: { $exists: false } });
  }
}

/**
 * GET /api/auth/login
 * Initiates the SSO flow by redirecting the browser to CCP's authorization page.
 */
router.get('/login', (req: Request, res: Response) => {
  const state = generateState();
  req.session.oauthState = state;

  // Save the session before redirecting (ensures the state is persisted)
  req.session.save((err) => {
    if (err) {
      console.error('[Auth] Failed to save session:', err);
      return res.status(500).json({ error: 'Session error' });
    }
    const url = getAuthorizationUrl(state);
    res.redirect(url);
  });
});

/**
 * GET /api/auth/callback
 * CCP redirects the user here after they authorize (or deny) the app.
 * Handles account creation, character linking, and data migration.
 */
router.get('/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;

    // Verify the state parameter matches what we stored (CSRF protection)
    if (!state || state !== req.session.oauthState) {
      return res.status(400).json({ error: 'Invalid or missing state parameter' });
    }

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Missing authorization code' });
    }

    // Exchange the authorization code for tokens
    const tokens = await exchangeCode(code);

    // Decode the JWT to get character info
    const { characterId, characterName } = verifyAndDecodeToken(tokens.accessToken);

    // --- Determine the account ---
    let accountId: string;

    // Check if this character already exists in the DB (returning user)
    const existingChar = await Character.findOne({ characterId });

    if (req.session.accountId) {
      // Case 1: Already logged in — add this character to the existing account
      accountId = req.session.accountId;
    } else if (existingChar?.accountId) {
      // Case 2: Character exists in DB with an account — use its existing account
      accountId = existingChar.accountId.toString();
    } else {
      // Case 3: Brand new character — create a new account
      const account = await Account.create({ primaryCharacterId: characterId });
      accountId = account._id.toString();
      console.log(`[Auth] Created new account for character ${characterName} (${characterId})`);
    }

    // Fetch the character's corporation ID from ESI public endpoint.
    // This is a public call (no auth needed) that tells us which corp the character is in.
    let corpId = 0;
    try {
      const charInfo = await axios.get<{ corporation_id: number }>(
        `https://esi.evetech.net/latest/characters/${characterId}/`,
        {
          params: { datasource: 'tranquility' },
          headers: { 'User-Agent': config.esi.userAgent },
          timeout: 10_000,
        }
      );
      corpId = charInfo.data.corporation_id;
    } catch (err) {
      // Non-fatal — we can still log in, just won't have corp ID yet
      console.warn('[Auth] Failed to fetch corporation ID from ESI:', err instanceof Error ? err.message : err);
    }

    // Parse the granted scopes from the JWT payload.
    // The JWT "scp" field contains the scopes as a string or array.
    let grantedScopes: string[] = ['publicData'];
    try {
      const payload = JSON.parse(
        Buffer.from(tokens.accessToken.split('.')[1]!, 'base64url').toString('utf-8'),
      );
      if (Array.isArray(payload.scp)) {
        grantedScopes = payload.scp;
      } else if (typeof payload.scp === 'string') {
        grantedScopes = [payload.scp];
      }
    } catch {
      // Fall back to publicData only
    }

    // Upsert the character with the determined account
    await Character.findOneAndUpdate(
      { characterId },
      {
        characterName,
        corporationId: corpId,
        accountId,
        accessToken:  tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiry:  new Date(Date.now() + tokens.expiresIn * 1000),
        scopes:       grantedScopes,
      },
      { upsert: true, new: true },
    );

    // Ensure character has settings (create with defaults if missing)
    const existingSettings = await Settings.findOne({ characterId });
    if (!existingSettings) {
      await Settings.create({ characterId });
    }

    // Set session
    req.session.characterId = characterId;
    req.session.accountId = accountId;
    delete req.session.oauthState;

    // Migrate any legacy global data to this account/character
    await migrateGlobalData(accountId, characterId);

    // Redirect to the frontend app
    const frontendUrl = config.frontendUrl;
    res.redirect(frontendUrl);
  } catch (err) {
    console.error('[Auth] Callback error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

/**
 * POST /api/auth/logout
 * Destroys the session and clears the cookie.
 */
router.post('/logout', (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('[Auth] Logout error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

/**
 * GET /api/auth/me
 * Returns the currently logged-in character's info, or 401 if not authenticated.
 */
router.get('/me', async (req: Request, res: Response) => {
  if (!req.session.characterId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const character = await Character.findOne(
    { characterId: req.session.characterId },
    { characterId: 1, characterName: 1, corporationId: 1, accountId: 1, scopes: 1, _id: 0 },
  );

  if (!character || !character.accountId) {
    // Character missing or legacy character without an account — force re-login
    return res.status(401).json({ error: 'Not authenticated' });
  }

  res.json({
    characterId:   character.characterId,
    characterName: character.characterName,
    corporationId: character.corporationId || 0,
    accountId:     character.accountId.toString(),
    scopes:        character.scopes || [],
  });
});

/**
 * GET /api/auth/characters
 * Returns all characters on the current account.
 */
router.get('/characters', async (req: Request, res: Response) => {
  if (!req.session.accountId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const characters = await Character.find(
    { accountId: req.session.accountId },
    { characterId: 1, characterName: 1, _id: 0 },
  ).lean();

  const activeId = req.session.characterId;
  const result = characters.map((c) => ({
    characterId:   c.characterId,
    characterName: c.characterName,
    active:        c.characterId === activeId,
  }));

  res.json(result);
});

/**
 * PUT /api/auth/switch/:characterId
 * Switch the active character (must belong to the same account).
 */
router.put('/switch/:characterId', async (req: Request, res: Response) => {
  if (!req.session.accountId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const targetId = parsePositiveInt(req.params['characterId'], 'characterId');

  // Verify this character belongs to the same account
  const character = await Character.findOne({
    characterId: targetId,
    accountId:   req.session.accountId,
  });

  if (!character) {
    return res.status(404).json({ error: 'Character not found on this account' });
  }

  // Ensure the target character has settings
  const existingSettings = await Settings.findOne({ characterId: targetId });
  if (!existingSettings) {
    await Settings.create({ characterId: targetId });
  }

  req.session.characterId = targetId;
  res.json({ ok: true, characterId: targetId });
});

export default router;
