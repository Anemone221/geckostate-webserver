// auth.middleware.ts
// Express middleware that requires a valid session with a logged-in character.
//
// Usage: apply to routes that need authentication:
//   router.get('/protected', requireAuth, (req, res) => { ... });
//
// Applied to all routes that need a logged-in character (settings, corp-trading, etc.).

import { Request, Response, NextFunction } from 'express';

/**
 * Middleware that rejects requests without a valid session.
 * Returns 401 if the user is not logged in via CCP SSO.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.characterId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  next();
}
