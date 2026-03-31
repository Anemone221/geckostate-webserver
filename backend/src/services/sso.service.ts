// sso.service.ts
// Handles CCP SSO OAuth2 flow: building auth URLs, exchanging codes for tokens,
// refreshing tokens, and decoding JWT access tokens.
//
// CCP SSO docs: https://developers.eveonline.com/docs/services/sso/
//
// Token lifecycle:
//   - Access token:  JWT, ~20 minutes, used for authenticated ESI calls
//   - Refresh token: permanent, used to get a new access token when it expires
//   - CCP may rotate the refresh token on each use — always store the new one

import axios from 'axios';
import crypto from 'crypto';
import { config } from '../config';
import { ESI_SCOPES_STRING } from '../constants';

// CCP SSO endpoints
const SSO_BASE = 'https://login.eveonline.com/v2/oauth';
const AUTHORIZE_URL = `${SSO_BASE}/authorize`;
const TOKEN_URL = `${SSO_BASE}/token`;

/** Token response from CCP's token endpoint. */
interface TokenResponse {
  accessToken:  string;
  refreshToken: string;
  expiresIn:    number;   // seconds until access token expires
}

/** Decoded character info from the JWT access token. */
interface CharacterInfo {
  characterId:   number;
  characterName: string;
}

/**
 * Generate a cryptographically random state string for CSRF protection.
 * Stored in the user's session before redirect, verified on callback.
 */
export function generateState(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Build the CCP SSO authorization URL that the user's browser should be redirected to.
 *
 * @param state  Random CSRF token (stored in session, verified on callback)
 */
export function getAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    redirect_uri:  config.ccp.callbackUrl,
    client_id:     config.ccp.clientId,
    scope:         ESI_SCOPES_STRING,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Exchange an authorization code for access + refresh tokens.
 * Called once after the user authorizes the app on CCP's login page.
 *
 * @param code  The authorization code from CCP's callback redirect
 */
export async function exchangeCode(code: string): Promise<TokenResponse> {
  const res = await axios.post(
    TOKEN_URL,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
    }).toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization:  `Basic ${Buffer.from(`${config.ccp.clientId}:${config.ccp.clientSecret}`).toString('base64')}`,
        'User-Agent':   config.esi.userAgent,
      },
    },
  );

  return {
    accessToken:  res.data.access_token,
    refreshToken: res.data.refresh_token,
    expiresIn:    res.data.expires_in,
  };
}

/**
 * Use a refresh token to get a new access token (and possibly a new refresh token).
 * CCP may rotate the refresh token — always store the returned refreshToken.
 *
 * @param refreshToken  The current refresh token from the Character document
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await axios.post(
    TOKEN_URL,
    new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization:  `Basic ${Buffer.from(`${config.ccp.clientId}:${config.ccp.clientSecret}`).toString('base64')}`,
        'User-Agent':   config.esi.userAgent,
      },
    },
  );

  return {
    accessToken:  res.data.access_token,
    refreshToken: res.data.refresh_token,
    expiresIn:    res.data.expires_in,
  };
}

/**
 * Decode and validate a CCP SSO JWT access token.
 *
 * CCP access tokens are JWTs with:
 *   - sub: "CHARACTER:EVE:12345678"  (the character ID)
 *   - name: "Character Name"
 *   - iss: "login.eveonline.com"
 *   - exp: unix timestamp
 *
 * We do a basic decode + validation here. For full security in production,
 * you'd verify the JWT signature against CCP's JWKS endpoint, but for a
 * self-hosted internal tool this is sufficient — we just got the token
 * directly from CCP's token endpoint over HTTPS.
 *
 * @param accessToken  JWT access token from CCP
 * @throws Error if the token is malformed, expired, or from wrong issuer
 */
export function verifyAndDecodeToken(accessToken: string): CharacterInfo {
  // JWT is three base64url segments: header.payload.signature
  const parts = accessToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT: expected 3 segments');
  }

  // Decode the payload (middle segment)
  const payload = JSON.parse(
    Buffer.from(parts[1]!, 'base64url').toString('utf-8'),
  );

  // Validate issuer — CCP uses the full URL as the issuer
  if (payload.iss !== 'login.eveonline.com' && payload.iss !== 'https://login.eveonline.com') {
    throw new Error(`Invalid JWT issuer: ${payload.iss}`);
  }

  // Validate expiry
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) {
    throw new Error('JWT has expired');
  }

  // Extract character ID from sub field: "CHARACTER:EVE:12345678"
  const sub = payload.sub as string;
  if (!sub || !sub.startsWith('CHARACTER:EVE:')) {
    throw new Error(`Invalid JWT sub format: ${sub}`);
  }
  const characterId = parseInt(sub.split(':')[2]!, 10);
  if (isNaN(characterId)) {
    throw new Error(`Could not parse character ID from sub: ${sub}`);
  }

  const characterName = payload.name as string;
  if (!characterName) {
    throw new Error('JWT missing character name');
  }

  return { characterId, characterName };
}
