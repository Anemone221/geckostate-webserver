# Architecture Overview

## System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser                                 │
│  React SPA (Vite dev server :5173 / served by Express in prod)  │
│  ┌──────────┬───────────┬────────────┬───────────┬───────────┐  │
│  │LP Analysis│  Plans    │   Doing    │ Corp Trade│  Settings │  │
│  └────┬─────┴─────┬─────┴──────┬─────┴─────┬─────┴─────┬─────┘  │
│       └───────────┴────────────┴───────────┴───────────┘        │
│                          React Query                             │
│                     (cache + fetch layer)                         │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP (JSON)
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Express Backend (:3000)                        │
│                                                                  │
│  Middleware: helmet → CORS → rate-limit → JSON → session → auth  │
│                                                                  │
│  Routes:   /api/auth          /api/lp            /api/settings   │
│            /api/items         /api/lp-rates      /api/lp-balances│
│            /api/manufacturing /api/market-depth   /api/sync       │
│            /api/offer-plans   /api/corp-trading                   │
│                                                                  │
│  Services: LP Analysis │ Manufacturing │ Market Depth │ ESI      │
│            SSO + Token │ Corp Trading Sync │ LP Rates Helper     │
│                                                                  │
│  Cron:     Market sync (15 min) │ History sync (daily 12:00 UTC) │
│            Corp trading sync (15 min)                             │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Mongoose
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                        MongoDB 7                                 │
│                                                                  │
│  Collections: item_types, blueprints, market_orders,             │
│    market_history, lp_offers, lp_store_rates, lp_balances,       │
│    settings, offer_plans, characters, accounts,                  │
│    corp_orders, wallet_transactions, wallet_journals,            │
│    corp_divisions, corp_trading_settings                          │
└──────────────────────────────────────────────────────────────────┘

External data sources:
  CCP SDE ──────→ item_types, blueprints (one-time import)
  EveRef  ──────→ market_history (daily import)
  ESI     ──────→ market_orders (15-min cron), lp_offers (manual sync)
  CCP SSO ──────→ characters, accounts (OAuth2 login)
  ESI Auth ─────→ corp_orders, wallet_transactions, wallet_journals (15-min cron)
```

---

## Backend Architecture

### Request Flow

Every API request goes through this middleware chain (order matters):

```
Request
  │
  ├─ helmet()           — Security headers (X-Frame-Options, HSTS, etc.)
  ├─ cors()             — Only allow requests from FRONTEND_URL origin
  ├─ rateLimit()        — RATE_LIMIT_MAX req / RATE_LIMIT_WINDOW_MS / IP
  ├─ express.json()     — Parse JSON body (1 MB limit)
  ├─ session()          — MongoDB-backed session (connect-mongo)
  │
  ├─ requireAuth()      — Check session.characterId (401 if missing)
  ├─ Route handler      — Process the request
  │   └─ Service layer  — Business logic + DB queries
  │
  ├─ 404 handler        — If no route matched
  └─ errorHandler       — Catch AppError / unknown errors, return JSON
```

### Shared Constants (`constants.ts`)

Centralized constants used across services and routes:

| Constant             | Value | Used By |
|----------------------|-------|---------|
| `BATCH_SIZE`         | 500   | ESI, SDE, corp-trading-sync bulk writes |
| `HISTORY_BATCH_SIZE` | 1000  | EveRef history imports |
| `LP_SYNC_BATCH_SIZE` | 10    | LP offer sync concurrency |
| `ESI_SCOPES`         | Object | SSO service, corp-trading-sync job |
| `RATE_LIMIT_WINDOW_MS` | 15 min | Express rate limiter |
| `RATE_LIMIT_MAX`     | 500   | Express rate limiter |
| `SESSION_MAX_AGE_MS` | 7 days | Express session cookie |

### Service Layer

Services contain all business logic. Routes are thin — they validate input, call a service, and return the result.

**LP Analysis Service** (`lp-analysis.service.ts`)

The most complex service. For a given corporation, it:

1. Loads all LP offers for that corp
2. Loads settings (tax rates, volume cap, logistics cost)
3. Loads user's LP balance for "redemptions available"
4. Identifies BPC offers by checking the blueprints collection
5. Collects all item type IDs that need pricing
6. Queries market orders for current sell prices (lowest sell)
7. Queries 7-day volume history for liquidity caps
8. For each offer, calculates:
   - Required items cost (tags, insignias)
   - Manufacturing material cost (BPC offers only)
   - Logistics cost (volume × ISK/m3)
   - Revenue after broker fee + sales tax
   - Profit and ISK/LP earned
   - Break-even sell price
   - Weekly sell cap
9. Sorts by ISK/LP descending (nulls at end)

**LP Rates Helper** (`lp-rates.helper.ts`)

Shared query helpers used by `lp.routes.ts`, `lp-rates.routes.ts`, and `lp-balances.routes.ts`:

- `getMergedLpRates(accountId, filterCorpIds?)` — Queries SDE seed rates + account-specific overrides and merges them. Optional corp ID filter for LP Analysis (only corps with offers).
- `validateCorporationExists(corporationId)` — Checks the corp exists in SDE seed data, returns its name or throws a 404 `AppError`.

**Market Depth Service** (`market-depth.service.ts`)

Walks the sell order book for an item:

1. Query all sell orders sorted by price ascending
2. Accumulate volume from cheapest to most expensive
3. Stop when requested quantity is filled (or supply runs out)
4. Return each step (price, qty used, line cost) plus totals
5. Weighted average = `totalCost / quantityFilled`

**Manufacturing Service** (`manufacturing.service.ts`)

Calculates profit for building an item:

1. Find the manufacturing blueprint (activityId = 1) that produces this item
2. Look up material prices and output price
3. Calculate material cost + logistics
4. Calculate revenue after taxes
5. Return profit, margin, break-even

**ESI Service** (`esi.service.ts`)

Thin HTTP client for CCP's ESI API:

- **ETag caching** — Stores ETags and sends `If-None-Match`; 304 responses skip processing
- **Expires header** — Tracks TTL using relative `Expires - Date` calculation to handle clock skew
- **Pagination** — `esiGetPaginated` / `esiAuthGetPaginated` reads `X-Pages` header, fetches all pages in parallel. `esiAuthGetCursor` handles cursor-based pagination (wallet transactions).
- **Rate limiting** — Respects CCP's 100 errors/15 min rule
- **Batch writes** — Upserts `BATCH_SIZE` (500) records at a time to MongoDB

**SSO Service** (`sso.service.ts`)

CCP EVE SSO OAuth2 implementation:

- Generates authorization URL with CSRF state token
- Exchanges authorization code for access/refresh tokens
- Verifies and decodes JWT to extract characterId + characterName
- Scopes requested: `ESI_SCOPES_STRING` (from constants)

**Token Service** (`token.service.ts`)

Manages ESI access token lifecycle:

- Checks token expiry, refreshes if needed
- Updates stored tokens in the characters collection
- Used by corp-trading-sync job for authenticated ESI calls

**Corp Trading Sync Service** (`corp-trading-sync.service.ts`)

Syncs corporation market data from ESI for authenticated characters:

- Fetches corp orders, wallet transactions (cursor-based), and journal entries
- Syncs all 7 wallet divisions
- Manages transaction cursors to avoid re-fetching old data
- Uses `BATCH_SIZE` for bulk writes

### Auth System (CCP SSO)

**Flow:** OAuth2 with CCP's EVE SSO → session-based auth stored in MongoDB (connect-mongo).

```
Browser                    Backend                    CCP SSO
  │                          │                          │
  ├── GET /api/auth/login ──→│                          │
  │   (generates state,      │                          │
  │    stores in session)     │                          │
  │←─ redirect URL ──────────│                          │
  │                          │                          │
  ├── redirect to CCP ──────────────────────────────────→│
  │                          │                          │
  │←─────────── callback with code + state ─────────────│
  │                          │                          │
  ├── GET /callback?code= ──→│                          │
  │                          ├── exchange code ─────────→│
  │                          │←─ tokens ────────────────│
  │                          ├── verify JWT             │
  │                          ├── upsert character       │
  │                          ├── set session fields     │
  │                          │                          │
  │←─ redirect to frontend ──│                          │
```

**Session fields:** `characterId`, `accountId`, `oauthState`

**Scoping:** Settings are per-character (skills affect taxes). LP data and corp trading are per-account.

### Background Jobs

| Job            | Schedule           | Service Called               | What It Does                                |
|----------------|--------------------|------------------------------|---------------------------------------------|
| Market sync    | `*/15 * * * *`     | `esi.syncMarketOrders()`     | Fetch all sell/buy orders for The Forge      |
| History sync   | `0 12 * * *`       | `syncMissingHistory()`       | Backfill missing days from EveRef            |
| Corp trading   | `*/15 * * * *`     | `corpTradingSyncJob()`       | Sync corp orders, transactions, journal (all 7 divisions) |

Jobs are started by `server.ts` after the Express server is listening. They run independently and log errors without crashing the server.

---

## Database Schema

### Collections and Their Relationships

```
                    ┌──────────────────┐
                    │    item_types    │
                    │ (34k+ EVE items) │
                    └───────┬──────────┘
                            │ typeId
         ┌──────────────────┼──────────────────────┐
         │                  │                      │
         ▼                  ▼                      ▼
  ┌──────────────┐  ┌──────────────┐     ┌────────────────┐
  │  blueprints  │  │ market_orders│     │ market_history  │
  │ (recipes)    │  │ (live orders)│     │ (daily OHLCV)   │
  └──────────────┘  └──────────────┘     └────────────────┘

  ┌──────────────┐  ┌──────────────┐     ┌────────────────┐
  │  lp_offers   │  │lp_store_rates│     │  lp_balances   │
  │ (LP store)   │  │ (ISK/LP paid)│     │ (user LP qty)  │
  └──────┬───────┘  └──────────────┘     └────────────────┘
         │ corporationId + offerId
         ▼
  ┌──────────────┐  ┌──────────────┐
  │ offer_plans  │  │   settings   │
  │ (tracked)    │  │ (per-char)   │
  └──────────────┘  └──────────────┘

  ┌──────────────┐  ┌──────────────┐     ┌────────────────┐
  │  characters  │  │   accounts   │     │ corp_orders     │
  │ (SSO tokens) │  │ (groups chars│     │ (corp market)   │
  └──────┬───────┘  └──────────────┘     └────────────────┘
         │ accountId
         ▼
  ┌───────────────────┐  ┌─────────────────┐  ┌──────────────────┐
  │wallet_transactions│  │ wallet_journals  │  │corp_trading_sets │
  │ (buy/sell history)│  │ (ISK movements)  │  │ (cursors, config)│
  └───────────────────┘  └─────────────────┘  └──────────────────┘

  ┌──────────────┐
  │corp_divisions│
  │ (div names)  │
  └──────────────┘
```

### Key Indexes

| Collection      | Index                                         | Purpose                                   |
|-----------------|-----------------------------------------------|-------------------------------------------|
| `item_types`    | `{ typeId: 1 }` (unique)                      | Fast lookup by ID                         |
| `item_types`    | `{ typeName: "text" }`                         | Full-text search                          |
| `blueprints`    | `{ blueprintTypeId: 1, activityId: 1 }`       | Find activities for a blueprint           |
| `blueprints`    | `{ 'products.typeId': 1, activityId: 1 }`     | Find blueprint that produces an item      |
| `market_orders` | `{ typeId, regionId, isBuyOrder, price: 1 }`  | Main query pattern (order book walks)     |
| `market_history`| `{ typeId, regionId, date: -1 }`              | Historical lookups (recent first)         |
| `market_history`| `{ typeId, regionId, date: 1 }` (unique)      | Prevent duplicate days                    |
| `lp_offers`     | `{ corporationId: 1, offerId: 1 }` (unique)   | Find offers by corp                       |
| `offer_plans`   | `{ corporationId: 1, offerId: 1 }` (unique)   | Track unique offers                       |
| `characters`    | `{ accountId: 1 }`                             | Find characters by account                |
| `corp_orders`   | `{ corporationId: 1, snapshotTime: 1 }`       | Snapshot cleanup queries                  |
| `corp_trading_settings` | `{ corporationId: 1 }`                | Find settings by corp                     |
| `wallet_transactions` | `{ corporationId: 1, division: 1 }`     | Per-division transaction queries          |
| `wallet_journals` | `{ corporationId: 1, division: 1, refType: 1 }` | Fee summary aggregation              |

---

## Frontend Architecture

### Page Structure

```
Layout (sidebar + main area)
├── /lp              → CorpPicker (search + select NPC corp)
├── /lp/:corpId      → OfferTable (ranked LP offers for selected corp)
├── /plans           → Plans (planning offers + materials + charts)
├── /doing           → Doing (active offers + materials + charts)
├── /manufacturing   → Manufacturing (item search + profit calc)
├── /history         → MarketHistory (30-day cost charts)
├── /corp-trading    → CorpTrading (orders, transactions, journal, fee summary)
└── /settings        → Settings (tax rates, LP rates, LP balances)
```

### Shared Utilities

**`lib/constants.ts`** — Centralized frontend magic numbers:

| Constant               | Value  | Purpose |
|------------------------|--------|---------|
| `STALE_TIME_DEFAULT`   | 5 min  | React Query stale time for most queries |
| `STALE_TIME_STATIC`    | 1 min  | Rarely-changing data (item names) |
| `FEEDBACK_TIMEOUT_MS`  | 2000   | "Saved!" / "Copied!" flash duration |
| `POPOVER_OPEN_DELAY_MS`| 200    | Hover delay before opening popover |
| `POPOVER_CLOSE_DELAY_MS`| 100   | Delay before closing (prevents flicker) |
| `POPOVER_MIN_SPACE_PX` | 300    | Min space below before flipping up |
| `POPOVER_GAP_PX`       | 4      | Gap between trigger and popover |

**`lib/formatters.ts`** — ISK, number, percentage, and date formatting helpers (`fmtIsk`, `fmtNum`, `fmtPct`, `fmtDate`). Re-exported from `lpCalc.ts` for backward compatibility.

**`hooks/usePopoverTrigger.ts`** — Shared hook for all hover-triggered portal popovers. Handles open/close delays, viewport-aware positioning (flips above when near bottom), and mouse tracking between trigger and popover. Accepts `'left'` or `'right'` anchor parameter.

### State Management

There is no Redux or global state store. All server data is managed by **React Query**:

- **Caching** — Data is fresh for `STALE_TIME_DEFAULT` (5 minutes, configurable per query)
- **Deduplication** — Multiple components using the same query share one network request
- **Background refresh** — Stale data is refetched when the window regains focus
- **Mutations** — `PUT`/`DELETE` operations invalidate related caches automatically

Client-only state (search input, form values, hover states) uses React `useState`.

### Data Flow: Plans/Doing Pages

These pages combine data from multiple API endpoints:

```
1. Fetch offer plans (status = "planning" or "doing")
   → List of { corporationId, offerId }

2. Extract unique corporationIds from plans

3. Fetch LP analysis for each unique corp (parallel useQueries)
   → Full offer data with costs, prices, profits

4. Match plans to their offer data by corporationId + offerId

5. For each offer's requiredItems, fetch market depth (parallel useQueries)
   → Order book walks for true cost calculation

6. Compute weekly projections (calcWeekly helper)
   → trueProfit, weeklyRedemptions, capitalNeeded, netProfit, ROI

7. Render table + charts + materials breakdown
```

### Component Patterns

**DataTable** — Generic table built on TanStack Table. Supports sorting, search, pagination, row hover callbacks, and loading skeletons. Used by LP Analysis, Plans, Doing, and Corp Trading pages.

**Popovers (MarketDepthPopover, ProfitBreakdownPopover, CapitalBreakdownPopover)** — All three use the `usePopoverTrigger` hook for shared hover/positioning logic. React Portals render floating panels outside overflow-constrained containers. Smart positioning flips above/below based on viewport space.

**ExportToolbar** — CSV (PapaParse), Excel (XLSX with multi-sheet support), and print. Column definitions are passed as props so each page controls what gets exported.

**Charts** — Recharts composable charts. ProfitBarChart for top-N profit visualization. CostBreakdownChart for 30-day stacked cost areas with a market rate line overlay.

---

## Data Import Pipeline

### SDE Import (`npm run import:sde`)

CCP publishes a Static Data Export containing all game data. The import:

```
CCP SDE URL
    │
    ▼
Download ZIP (~50 MB)
    │
    ▼
Extract JSONL files (streaming, not loaded into memory)
    │
    ├── types.jsonl ────────→ item_types collection (34k+ items)
    ├── blueprints.jsonl ──→ blueprints collection (activities 1 & 8 only)
    └── npcCorporations.jsonl → lp_store_rates collection (corp names)
```

- **Version check** — Compares build number; skips if unchanged
- **Streaming** — Processes line by line (handles large files)
- **Batch writes** — `BATCH_SIZE` (500) records per MongoDB bulkWrite
- **Local path** — Set `LOCAL_SDE_PATH` to skip download

### History Import (`npm run import:history`)

EveRef publishes daily market history files:

```
https://data.everef.net/market-history/YYYY/market-history-YYYY-MM-DD.csv.bz2
    │
    ▼
Download bz2 file
    │
    ▼
Decompress stream
    │
    ▼
Parse CSV (date, region_id, type_id, average, highest, lowest, order_count, volume)
    │
    ▼
Filter to primary region only
    │
    ▼
Upsert to market_history collection
```

Imports last 30 days. Skips 404s (older files sometimes missing). 300ms delay between files to be polite. Uses `HISTORY_BATCH_SIZE` (1000) for bulk writes.

---

## Key Design Decisions

### Why MongoDB?

- EVE data is document-shaped (LP offers have nested required items, blueprints have nested materials/products)
- Market orders are bulk-upserted every 15 minutes — MongoDB's `bulkWrite` handles this efficiently
- Flexible schema lets us add fields without migrations
- `mongodb-memory-server` enables fast testing without Docker

### Why No ORM (Just Mongoose)?

- Mongoose's `lean()` queries return plain objects (fast, no overhead)
- Schema validation at the DB layer catches bugs early
- Compound indexes are easy to define and optimize

### Why Custom ESI Client?

- Popular ESI libraries had transitive dependency vulnerabilities
- A thin axios wrapper gives full control over ETag caching and pagination
- Less code to maintain than a full library

### Why React Query Instead of Redux?

- All state is server-derived — there's no complex client-side state to manage
- React Query handles caching, deduplication, and background refresh out of the box
- Mutations automatically invalidate related caches
- Much less boilerplate than Redux for a data-fetching-heavy app

### Why Portal-Based Popovers?

The page layout has nested `overflow-auto` and `overflow-hidden` containers (sidebar layout, scrollable tables, materials sections). Standard `position: absolute` popovers get clipped by these containers. React Portals render the popover directly on `document.body`, escaping all overflow constraints. The shared `usePopoverTrigger` hook extracts ~50 lines of identical hover/positioning logic from all three popover components.

### Why Denormalized Names?

Corporation and item names are stored alongside IDs in `offer_plans` and `lp_store_rates`. This avoids extra lookups when rendering lists — the UI can display names without joining to `item_types` or fetching from ESI.

### Why Session-Based Auth (Not JWT)?

- Session tokens are opaque — no sensitive data in the cookie
- Server-side sessions can be invalidated instantly (logout)
- MongoDB session store (connect-mongo) fits the existing stack
- Simpler than managing JWT refresh token rotation

---

## Environment Configuration

All configuration flows through `backend/src/config/index.ts`, which reads from `.env`:

| Category   | Variables                                       | Defaults                          |
|------------|-------------------------------------------------|-----------------------------------|
| Server     | `PORT`                                          | 3000                              |
| Database   | `MONGO_URI`                                     | mongodb://localhost:27017/geckostate |
| Security   | `SESSION_SECRET`, `FRONTEND_URL`                | — (required), http://localhost:5173 |
| CCP SSO    | `CCP_CLIENT_ID`, `CCP_CLIENT_SECRET`, `CCP_CALLBACK_URL` | — (required for auth)   |
| ESI        | `ESI_USER_AGENT`                                | geckostate-market-planner/1.0     |
| Data       | `EVEREF_BASE_URL`, `CCP_SDE_URL`, `LOCAL_SDE_PATH` | EveRef/CCP defaults           |
| Analysis   | `PRIMARY_REGION_ID`                             | 10000002 (The Forge / Jita)       |

---

## Testing Strategy

Tests use **Vitest + Supertest + mongodb-memory-server**:

- An in-memory MongoDB instance starts once for all test files (`globalSetup.ts`)
- Collections are cleared between test files (`setup.ts`)
- Shared seed helpers create consistent test data (`seed.ts`)
- Shared SSO/token mock factories (`createSsoMock()`, `createTokenMock()` in `seed.ts`) — used by all auth-dependent tests via Vitest's async factory pattern
- Tests run sequentially (not in parallel) to prevent database race conditions
- Rate limiting is disabled when `MONGO_TEST_URI` is set
- No Docker, no external services — just `npm test`

```
143 tests across 11 test files:
  health.test.ts         — 3 tests  (server health check)
  items.test.ts          — 11 tests (search + lookup)
  settings.test.ts       — 8 tests  (get + update)
  lp-rates.test.ts       — 9 tests  (get + set rates)
  lp-balances.test.ts    — 8 tests  (get + set balances)
  lp-analysis.test.ts    — 16 tests (full LP calculation pipeline)
  manufacturing.test.ts  — 16 tests (material cost + profit)
  market-depth.test.ts   — 8 tests  (order book walk)
  sync.test.ts           — 6 tests  (manual sync triggers)
  auth.test.ts           — 27 tests (SSO login, callback, logout, switch character)
  corp-trading.test.ts   — 31 tests (orders, transactions, journal, divisions, settings, sync, fees)
```
