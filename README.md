# GeckoState — EVE Online Market Planner

A self-hosted tool for analyzing **LP store** and **manufacturing** profitability in EVE Online. Tracks live market data, walks order books, and calculates true ISK/LP values so you can find the best ways to convert loyalty points into profit.

## What It Does

- **LP Analysis** — Ranks every offer in a corporation's LP store by ISK/LP earned, factoring in broker fees, sales tax, required items, and manufacturing costs (for BPC offers).
- **Order Book Walks** — Instead of assuming you can buy everything at the cheapest price, walks sell orders from cheapest to most expensive to show real costs.
- **Planning & Tracking** — Mark offers as "Planning" or "Doing", see combined capital requirements, weekly profit projections, and ROI across your portfolio.
- **Manufacturing Calculator** — Full material cost and profit breakdown for any manufacturable item.
- **Market History** — 30-day cost breakdown charts overlaid with market rates to spot trends.
- **Export** — CSV, Excel (multi-sheet), and print support for all tables.

## Tech Stack

| Layer      | Technology                                              |
|------------|---------------------------------------------------------|
| Backend    | Node.js, TypeScript, Express, Mongoose                  |
| Frontend   | React, TypeScript, Vite, TailwindCSS, TanStack (Query + Table), Recharts |
| Database   | MongoDB 7                                               |
| Deployment | Docker Compose (Proxmox / any Docker host)              |

## Project Structure

```
geckostate-webserver/
├── backend/                 # Express API server
│   ├── src/
│   │   ├── api/             # Route handlers (one file per resource)
│   │   ├── models/          # Mongoose schemas (17 collections)
│   │   ├── services/        # Business logic (ESI, LP analysis, manufacturing, market depth)
│   │   ├── jobs/            # Cron jobs (market sync, history sync, corp trading sync)
│   │   ├── middleware/      # Auth + error handler
│   │   ├── utils/           # Input validation helpers
│   │   ├── config/          # Environment config loader
│   │   ├── tests/           # Vitest test suite (143 tests)
│   │   ├── app.ts           # Express app setup (middleware + routes)
│   │   └── server.ts        # Entry point (DB connect, start server, start crons)
│   ├── Dockerfile
│   └── package.json
├── frontend/                # React SPA
│   ├── src/
│   │   ├── pages/           # Route pages (LP Analysis, Plans, Doing, Manufacturing, etc.)
│   │   ├── components/      # Shared UI (DataTable, popovers, charts, Layout)
│   │   ├── api/             # React Query hooks for each API resource
│   │   └── lib/             # Calculation helpers + formatting utilities
│   ├── vite.config.ts
│   └── package.json
├── docs/                    # Documentation
│   ├── API.md               # Full API reference
│   ├── ARCHITECTURE.md      # System architecture overview
│   └── CORP-TRADING.md      # Corp trading architecture
├── docker-compose.yml       # MongoDB + backend containers
└── .env.example             # Environment variable template
```

## Quick Start

### Prerequisites

- **Node.js 20+** and **npm**
- **MongoDB 7** (via Docker or local install)
- **Git**

### 1. Clone and install

```bash
git clone <repo-url> geckostate-webserver
cd geckostate-webserver

# Install backend dependencies
cd backend && npm install && cd ..

# Install frontend dependencies
cd frontend && npm install && cd ..
```

### 2. Configure environment

```bash
cp .env.example backend/.env
```

Edit `backend/.env` and set at minimum:

| Variable         | What to set                                    |
|------------------|------------------------------------------------|
| `MONGO_URI`      | `mongodb://localhost:27017/geckostate` (local)  |
| `SESSION_SECRET`  | Any long random string                         |
| `ESI_USER_AGENT` | Your app name + contact email (CCP requirement) |

See `.env.example` for all available options with explanations.

### 3. Start MongoDB

**With Docker (recommended):**

```bash
# Set the password for MongoDB
export MONGO_PASSWORD=your_strong_password_here

docker compose up -d mongo
```

**Or use a local MongoDB installation** — just make sure it's running on port 27017.

### 4. Import EVE static data

```bash
cd backend

# Import item types, blueprints, and NPC corporations from CCP's SDE
npm run import:sde

# Import 30 days of market price history from EveRef
npm run import:history
```

The SDE import downloads ~50MB from CCP (or reads from a local path if `LOCAL_SDE_PATH` is set).

### 5. Start development servers

Open two terminals:

```bash
# Terminal 1 — Backend API (port 3000)
cd backend && npm run dev

# Terminal 2 — Frontend dev server (port 5173)
cd frontend && npm run dev
```

Open **http://localhost:5173** in your browser.

The Vite dev server proxies `/api/*` requests to the backend, so no CORS issues in development.

## Docker Deployment

For production, the entire stack runs in Docker:

```bash
# Set required env vars
export MONGO_PASSWORD=your_strong_password_here

# Build and start everything
docker compose up -d --build
```

This starts:
- **MongoDB** on port 27017 (with authentication)
- **Backend** on port 3000 (serves the compiled React frontend in production)

The frontend is compiled during the Docker build and served as static files by Express.

## Running Tests

The backend has 143 tests using Vitest + Supertest + an in-memory MongoDB server. No Docker or external database needed.

```bash
cd backend

npm test              # Run all tests once
npm run test:watch    # Watch mode (re-runs on file changes)
npm run test:coverage # Generate coverage report
```

## Background Jobs

Three cron jobs run automatically when the server starts:

| Job              | Schedule          | What it does                              |
|------------------|-------------------|-------------------------------------------|
| Market sync      | Every 15 minutes  | Fetches live market orders from ESI       |
| History sync     | Daily at 12:00 UTC| Backfills any missing price history from EveRef (after EVE downtime) |
| Corp trading sync| Every 15 minutes  | Syncs corp orders, transactions, and journal from ESI (all 7 wallet divisions) |

You can also trigger syncs manually via the API:

```bash
curl -X POST http://localhost:3000/api/sync/market
curl -X POST http://localhost:3000/api/sync/lp-offers
```

## Documentation

- [API Reference](docs/API.md) — All endpoints with parameters, responses, and examples
- [Architecture Overview](docs/ARCHITECTURE.md) — System design, data flow, models, and key decisions
- [Corp Trading](docs/CORP-TRADING.md) — Corporation trading sync, fee calculations, and UI architecture

## EVE Data Sources

| Source | What | How |
|--------|------|-----|
| [CCP SDE](https://developers.eveonline.com/) | Item types, blueprints, NPC corps | One-time import (`npm run import:sde`) |
| [EveRef](https://data.everef.net) | Daily market history (OHLCV) | Daily import (`npm run import:history`) |
| [ESI](https://esi.evetech.net) | Live market orders, LP store offers | Hourly cron job + manual sync |
