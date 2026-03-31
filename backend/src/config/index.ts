// config/index.ts
// Loads environment variables from .env and exports them as typed constants.
// All other files import from here — centralising config means if a variable
// name changes, you only update it in one place.

import dotenv from 'dotenv';

// Load the .env file. Must happen before anything reads process.env.
dotenv.config();

// Helper that throws a clear error if a required variable is missing.
// This fails fast at startup rather than silently using undefined later.
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Helper for optional variables that have a fallback default.
function optional(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

export const config = {
  // Server
  port: parseInt(optional('PORT', '3000'), 10),
  sessionSecret: required('SESSION_SECRET'),
  frontendUrl: optional('FRONTEND_URL', 'http://localhost:5173'),

  // MongoDB connection string
  mongoUri: optional('MONGO_URI', 'mongodb://localhost:27017/geckostate'),

  // CCP SSO credentials — registered at developers.eveonline.com
  ccp: {
    clientId: optional('CCP_CLIENT_ID', ''),
    clientSecret: optional('CCP_CLIENT_SECRET', ''),
    callbackUrl: optional('CCP_CALLBACK_URL', 'http://localhost:3000/api/auth/callback'),
  },

  // ESI API settings
  esi: {
    // User-Agent is required by CCP — identifies your app if they need to contact you
    userAgent: optional('ESI_USER_AGENT', 'geckostate-market-planner/1.0'),
  },

  // External data source URLs
  data: {
    everefBaseUrl: optional('EVEREF_BASE_URL', 'https://data.everef.net'),
    sdeUrl: optional(
      'CCP_SDE_URL',
      'https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip'
    ),
    // Optional path to an already-extracted SDE folder on disk.
    // When set, the SDE import reads from local files instead of downloading the zip.
    // Example: F:/Downloads/eve-online-static-data-3231590-jsonl
    localSdePath: optional('LOCAL_SDE_PATH', ''),
  },

  // The EVE region we focus on for market data
  // 10000002 = The Forge (contains Jita, the main trading hub)
  primaryRegionId: parseInt(optional('PRIMARY_REGION_ID', '10000002'), 10),
};
