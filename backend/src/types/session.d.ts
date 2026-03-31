// session.d.ts
// Extends the express-session SessionData interface to include our custom fields.
// TypeScript merges this with the existing SessionData type via declaration merging.

import 'express-session';

declare module 'express-session' {
  interface SessionData {
    /** The logged-in EVE character's ID (set after SSO callback) */
    characterId?: number;
    /** The account ID grouping all characters for this user */
    accountId?: string;
    /** Random string used to prevent CSRF during the OAuth2 login flow */
    oauthState?: string;
  }
}
