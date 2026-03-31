# Corp Trading Architecture

The Corp Trading page (`/corp-trading`) tracks corporation market activity: orders, transactions, fees, and LP purchases. Data flows from CCP's ESI API → MongoDB → Express API → React frontend.

---

## 1. Data Sync (ESI → MongoDB)

### Trigger Methods
- **Automatic:** Cron job every 15 minutes (`corp-trading-sync.job.ts`)
- **Manual:** POST `/api/corp-trading/sync` (Sync Now button)

### Sync Functions (all in `corp-trading-sync.service.ts`)

| Function | ESI Endpoint | Collection | Pagination | Notes |
|---|---|---|---|---|
| `syncCorpOrders()` | `GET /corporations/{id}/orders/` | `corp_orders` | X-Pages | Snapshot cleanup: deletes orders missing from latest ESI response |
| `syncCorpTransactions()` | `GET /corporations/{id}/wallets/{div}/transactions/` | `wallet_transactions` | Cursor-based | Incremental via stored `afterToken`. First sync walks back 50 pages |
| `syncCorpJournal()` | `GET /corporations/{id}/wallets/{div}/journal/` | `wallet_journal` | X-Pages | Full fetch each time. Entries are immutable |
| `syncCorpDivisions()` | `GET /corporations/{id}/divisions/` | `corp_divisions` | None | Single call. Stores wallet + hangar division names |

- Transactions and journal are synced **per-division** (1-7), orders and divisions are **corp-wide**
- All use `bulkWrite` with upsert (batch size 500) for idempotent writes
- ESI omits `is_buy_order` for sell orders → sync defaults to `false` via `?? false`

---

## 2. MongoDB Collections

| Collection | Unique Key | Scope |
|---|---|---|
| `corp_orders` | `orderId` | Per corporation |
| `wallet_transactions` | `(transactionId, corporationId, division)` | Per division |
| `wallet_journal` | `(journalId, corporationId, division)` | Per division |
| `corp_divisions` | `(corporationId, division, isWallet)` | Per corporation |
| `corp_trading_settings` | `accountId` | Per account |
| `settings` | `characterId` | Per character (has `salesTaxPct`) |

### Key Journal refTypes

| refType | Meaning | Used In |
|---|---|---|
| `market_transaction` | Completed buy/sell trade | Transaction matching |
| `brokers_fee` | Broker fee for placing/modifying order | Fee summary (costs) |
| `transaction_tax` | Sales tax on completed sale | Fee summary (costs) |
| `corporation_account_withdrawal` | ISK transferred out of corp wallet | LP purchases (togglable) |
| `lp_store` | Direct payment to NPC LP store | LP purchases (togglable) |

---

## 3. Fee Summary Calculations

Source: `getFeeSummary()` in `corp-trading-interpretation.service.ts`

### Input
- `corporationId`, `division`, `days` (period), `characterId` (for tax rate)

### Aggregation from Journal Entries (within period)

```
totalBrokerFees  = SUM(|amount|) for refType = 'brokers_fee'
totalSalesTax    = SUM(|amount|) for refType = 'transaction_tax'
lpPurchases      = SUM(|amount|) for refType IN ['corporation_account_withdrawal', 'lp_store']
                   WHERE isLpPurchase !== false
```

### Aggregation from Transactions (within period)

```
FOR each WalletTransaction:
  total = quantity × unitPrice
  IF isBuy  → grossSpend  += total
  ELSE      → grossRevenue += total
```

### Derived Totals

```
netRevenue       = grossRevenue - totalBrokerFees - totalSalesTax
profit           = grossRevenue - grossSpend - lpPurchases - totalBrokerFees - totalSalesTax
```

### Potential Profit (from open sell orders)

```
potentialRevenue   = SUM(price × volumeRemain) for open sell orders in this division
potentialSalesTax  = potentialRevenue × character.salesTaxPct (default 1.8%)
potentialProfit    = profit + potentialRevenue - potentialSalesTax
```

### isLpPurchase Toggle
- `null` (default) = **included** in LP Purchases total
- `true` = explicitly included
- `false` = explicitly excluded
- Check: `isLpPurchase !== false` (so null counts as included)

---

## 4. Transaction Interpretation

Source: `getInterpretedTransactions()` in `corp-trading-interpretation.service.ts`

### Fee Matching Logic

```
WalletTransaction.journalRefId → WalletJournal.journalId (market_transaction entry)
                                 → journal.contextId (the order ID)
                                 → Match brokers_fee entries with same contextId
                                 → Match transaction_tax entries with same contextId
```

### Per-Transaction Output

```
totalIsk  = quantity × unitPrice
brokerFee = matched from brokers_fee journal entry (by contextId), or null
salesTax  = matched from transaction_tax journal entry (by contextId), or null
netProfit = (sell only) totalIsk - brokerFee - salesTax
```

---

## 5. API Endpoints

All under `/api/corp-trading/`, all require `requireAuth`.

### Queries

| Method | Path | Params | Returns |
|---|---|---|---|
| GET | `/divisions` | — | Division names (wallet only) |
| GET | `/orders` | — | All corp orders (all divisions) |
| GET | `/transactions` | `?division=1&limit=100` | Interpreted transactions with matched fees |
| GET | `/journal` | `?division=1&limit=100` | Raw journal entries |
| GET | `/fee-summary` | `?division=1&days=30` | FeeSummary object (9 calculated fields) |
| GET | `/withdrawals` | `?division=1` | Journal entries with refType `corporation_account_withdrawal` |
| GET | `/lp-store-purchases` | `?division=1&since=2026-01-01` | Journal entries with refType `lp_store` |
| GET | `/settings` | — | Saved division + sync timestamps |
| GET | `/journal-ref-types` | `?division=1` | Debug: distinct refTypes in division |

### Mutations

| Method | Path | Body | Effect |
|---|---|---|---|
| POST | `/sync` | — | Sync all data from ESI |
| PUT | `/settings` | `{ walletDivision }` | Save selected division |
| PATCH | `/withdrawals/:journalId` | `{ division, isLpPurchase }` | Toggle LP flag on withdrawal |
| PATCH | `/lp-store-purchases/:journalId` | `{ division, isLpPurchase }` | Toggle LP flag on LP store entry |

---

## 6. Frontend (React)

### Component Structure

```
CorpTrading (main page)
├── Division selector (saves to settings)
├── Refresh button (invalidates React Query cache — no ESI)
├── Sync Now button (POST /sync — hits ESI)
├── OrdersTab (DataTable of all corp orders — Item Name, Side, Price, Remaining, Total, Total ISK, Wallet, Issued, Expiry)
├── TransactionsTab (DataTable of interpreted transactions per division)
├── FeeSummaryTab
│   ├── Period selector (7d / 30d / 90d)
│   ├── 9 summary cards (3×3 grid)
│   ├── Corporation Withdrawals table (checkboxes)
│   └── LP Store Purchases table (checkboxes + date filter)
└── JournalTab (DataTable of raw journal entries per division)
```

### React Query Keys & Invalidation

| Hook | Query Key | Invalidated By |
|---|---|---|
| `useCorpDivisions()` | `['corp-trading', 'divisions']` | Sync |
| `useCorpOrders()` | `['corp-trading', 'orders']` | Sync |
| `useCorpTransactions(div)` | `['corp-trading', 'transactions', div, limit]` | Sync |
| `useCorpJournal(div)` | `['corp-trading', 'journal', div, limit]` | Sync |
| `useCorpFeeSummary(div, days)` | `['corp-trading', 'fee-summary', div, days]` | Sync, LP toggles |
| `useCorpWithdrawals(div)` | `['corp-trading', 'withdrawals', div]` | Sync, withdrawal toggle |
| `useCorpLpStorePurchases(div, since)` | `['corp-trading', 'lp-store-purchases', div, since]` | Sync, LP store toggle |
| `useCorpTradingSettings()` | `['corp-trading', 'settings']` | Settings update |

**Targeted invalidation:** Toggle mutations only invalidate the specific queries they affect (not all corp-trading queries). Sync invalidates everything.

### Fee Summary Cards Layout

```
Row 1:  Gross Revenue (green)  |  Gross Spend (red)       |  LP Purchases (red)
Row 2:  Net Revenue (±)        |  Broker Fees (red)       |  Sales Tax (red)
Row 3:  Profit (±)             |  Potential Profit (±)    |  Potential Sales Tax (red)
```

---

## 7. Data Flow Diagram

```
ESI (CCP Servers)
    │
    ▼ (every 15 min or manual sync)
syncCorpOrders ──────────► corp_orders
syncCorpTransactions ────► wallet_transactions
syncCorpJournal ─────────► wallet_journal
syncCorpDivisions ───────► corp_divisions
    │
    ▼ (on API request)
getFeeSummary() ◄─── wallet_journal (fees + withdrawals + lp_store)
                ◄─── wallet_transactions (buy/sell totals)
                ◄─── corp_orders (open sell orders → potential)
                ◄─── settings (salesTaxPct)
    │
    ▼
GET /fee-summary → FeeSummary JSON → 9 summary cards
GET /withdrawals → withdrawal entries → checkbox table
GET /lp-store-purchases → LP store entries → checkbox table + date filter
```

---

## 8. Key Design Decisions

1. **Division scoping:** Transactions, journal, withdrawals, LP purchases, and fee summary are all scoped to the selected wallet division. Orders are corp-wide.

2. **Potential profit per-division:** Open sell orders are filtered by `walletDivision` to keep project profitability separated (LP Income vs Indy Income).

3. **LP purchase default = included:** `isLpPurchase: null` counts as included. Users opt-out by unchecking, not opt-in.

4. **Targeted query invalidation:** Toggle mutations only refetch affected queries (2 instead of 7+) to minimize unnecessary requests.

5. **ESI `is_buy_order` quirk:** ESI omits this field for sell orders. Sync defaults to `false` via `?? false`.

6. **Rate limiter:** 500 requests per 15-minute window per IP. Disabled during tests.

7. **Corp trading sync scope check:** The sync job requires both `CORP_ORDERS` and `CORP_WALLETS` scopes on the character. Characters missing either scope are skipped.
