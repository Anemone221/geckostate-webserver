// app.ts
// Configures and exports the Express application.
// Kept separate from server.ts so the app can be tested without starting a real server.
//
// Middleware chain (order matters in Express):
//   1. express.json()    — parse incoming JSON request bodies
//   2. API routes        — handle the actual requests
//   3. Static frontend   — serves built React app (production only)
//   4. 404 handler       — catch requests that matched no route
//   5. errorHandler      — catch any errors thrown during request processing

import path from 'path';
import express from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { errorHandler } from './middleware/error.middleware';
import { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, SESSION_MAX_AGE_MS } from './constants';
import itemsRouter from './api/items.routes';
import lpRouter from './api/lp.routes';
import manufacturingRouter from './api/manufacturing.routes';
import settingsRouter from './api/settings.routes';
import lpRatesRouter from './api/lp-rates.routes';
import lpBalancesRouter from './api/lp-balances.routes';
import syncRouter from './api/sync.routes';
import offerPlansRouter from './api/offer-plans.routes';
import marketDepthRouter from './api/market-depth.routes';
import authRouter from './api/auth.routes';
import corpTradingRouter from './api/corp-trading.routes';

export function createApp(): express.Application {
  const app = express();

  // --- Security middleware ---

  // helmet() sets a bundle of HTTP response headers that improve security:
  //   - X-Content-Type-Options: nosniff   (prevents MIME-type sniffing)
  //   - X-Frame-Options: SAMEORIGIN       (prevents clickjacking via iframes)
  //   - Strict-Transport-Security          (forces HTTPS after first visit)
  //   - X-XSS-Protection, Referrer-Policy, and more
  app.use(helmet());

  // CORS — only allow requests from your frontend's origin.
  // Without this, any website could make API calls to your backend.
  app.use(cors({
    origin:      config.frontendUrl,
    credentials: true,
    methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  }));

  // Rate limiting — prevents abuse by capping requests per IP.
  // Requests per 15-minute window; excess gets a 429 response.
  // Disabled during tests (MONGO_TEST_URI is set by vitest globalSetup)
  // to avoid hitting the limit when running many test cases with loginAgent().
  if (!process.env['MONGO_TEST_URI']) {
    app.use('/api/', rateLimit({
      windowMs: RATE_LIMIT_WINDOW_MS,
      max:      RATE_LIMIT_MAX,
      message:  { error: 'Too many requests, try again later' },
    }));
  }

  // Parse incoming JSON bodies, with a 1 MB size cap to prevent
  // someone sending a massive payload to eat server memory.
  app.use(express.json({ limit: '1mb' }));

  // --- Session middleware ---
  // Stores sessions in MongoDB via connect-mongo so they survive server restarts.
  // The session cookie is HTTP-only (not accessible to JavaScript) and uses
  // SameSite=Lax to prevent CSRF while still allowing normal navigation.
  //
  // In tests, MONGO_TEST_URI is set by the test setup — use it for the session store
  // so connect-mongo connects to the in-memory MongoDB instance.
  const mongoUrl = process.env['MONGO_TEST_URI'] || config.mongoUri;
  app.use(session({
    secret:            config.sessionSecret,
    resave:            false,
    saveUninitialized: false,
    store:             MongoStore.create({ mongoUrl }),
    cookie: {
      httpOnly: true,
      secure:   process.env['NODE_ENV'] === 'production',
      sameSite: 'lax',
      maxAge:   SESSION_MAX_AGE_MS,
    },
  }));

  // --- Health check ---
  // Simple endpoint to verify the server and database are running.
  // Docker and monitoring tools ping this to know if the service is healthy.
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // --- API Routes ---
  app.use('/api/items', itemsRouter);
  app.use('/api/lp', lpRouter);
  app.use('/api/manufacturing', manufacturingRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/lp-rates', lpRatesRouter);
  app.use('/api/lp-balances', lpBalancesRouter);
  app.use('/api/sync', syncRouter);
  app.use('/api/offer-plans', offerPlansRouter);
  app.use('/api/market-depth', marketDepthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/corp-trading', corpTradingRouter);

  // --- Static frontend (production only) ---
  // In development, Vite's dev server runs on port 5173 and proxies /api to here.
  // In production (`npm run build` in frontend/), the compiled React app lands in
  // backend/public/ and is served directly by this Express server.
  if (process.env['NODE_ENV'] === 'production') {
    const publicDir = path.join(__dirname, '..', 'public');
    app.use(express.static(publicDir));
    // SPA fallback — any non-API route serves index.html so React Router handles it
    app.get('*', (_req, res) => {
      res.sendFile(path.join(publicDir, 'index.html'));
    });
  }

  // 404 handler — runs when no route above matched the request
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Global error handler — MUST be registered after all routes
  app.use(errorHandler);

  return app;
}
