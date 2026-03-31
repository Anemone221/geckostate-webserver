// token.service.ts
// Centralised helper that ensures a character's ESI access token is valid
// before making authenticated API calls.
//
// Usage:
//   const accessToken = await getValidAccessToken(characterId);
//   const data = await esiAuthGet('/some/path', accessToken);
//
// The token is refreshed automatically if it expires within 60 seconds.
// CCP may rotate the refresh token on each use — we always store the new one.

import { Character } from '../models/character.model';
import { refreshAccessToken } from './sso.service';

// Buffer in milliseconds — refresh if token expires within this window.
// 60 seconds gives us a comfortable margin to complete the ESI call.
const EXPIRY_BUFFER_MS = 60_000;

/**
 * Get a valid ESI access token for a character.
 * If the current token is about to expire, refreshes it automatically
 * and updates the Character document in the database.
 *
 * @param characterId  The EVE character ID
 * @returns A valid access token string
 * @throws Error if the character is not found or token refresh fails
 */
export async function getValidAccessToken(characterId: number): Promise<string> {
  const character = await Character.findOne({ characterId });
  if (!character) {
    throw new Error(`Character ${characterId} not found`);
  }

  // Check if the current token is still valid (with buffer)
  const now = Date.now();
  if (character.tokenExpiry.getTime() > now + EXPIRY_BUFFER_MS) {
    return character.accessToken;
  }

  // Token expired or about to expire — refresh it
  const tokens = await refreshAccessToken(character.refreshToken);

  // Update the character with the new tokens
  // CCP may rotate the refresh token, so always store the new one
  character.accessToken = tokens.accessToken;
  character.refreshToken = tokens.refreshToken;
  character.tokenExpiry = new Date(now + tokens.expiresIn * 1000);
  await character.save();

  return tokens.accessToken;
}
