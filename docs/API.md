# API Reference

Base URL: `http://localhost:3000/api`

All endpoints return JSON. Errors follow a consistent format:

```json
{ "error": "Description of what went wrong" }
```

Common HTTP status codes:
- **200** — Success
- **400** — Bad request (missing/invalid parameters)
- **404** — Resource not found
- **429** — Rate limited (500 requests per 15 minutes per IP)
- **500** — Internal server error

---

## Health

### `GET /api/health`

Check if the server is running.

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2026-03-01T12:00:00.000Z"
}
```

---

## Items

### `GET /api/items?name=<search>`

Search items by name (case-insensitive).

| Param  | Type   | Required | Description                    |
|--------|--------|----------|--------------------------------|
| `name` | string | Yes      | Search term (minimum 2 chars)  |

**Response:** Array of up to 20 matching items.

```json
[
  {
    "typeId": 34,
    "typeName": "Tritanium",
    "marketGroupId": 4,
    "volume": 0.01
  }
]
```

### `GET /api/items/:typeId`

Get a single item by its EVE type ID.

| Param    | Type | Required | Description       |
|----------|------|----------|-------------------|
| `typeId` | int  | Yes      | Positive integer  |

**Response:**

```json
{
  "typeId": 34,
  "typeName": "Tritanium",
  "marketGroupId": 4,
  "volume": 0.01,
  "published": true
}
```

**Errors:** 404 if item not found, 400 if typeId is not a positive integer.

---

## LP Analysis

### `GET /api/lp/corps`

List all NPC corporations that have LP store offers.

**Response:**

```json
[
  {
    "corporationId": 1000125,
    "corporationName": "Serpentis Corporation",
    "iskPerLp": 3000
  },
  {
    "corporationId": 1000180,
    "corporationName": "Blood Raiders",
    "iskPerLp": null
  }
]
```

`iskPerLp` is the user's configured purchase price. `null` means not set.

### `GET /api/lp/:corporationId`

Full profitability analysis for every offer in a corporation's LP store. Returns offers ranked by ISK/LP earned (highest first, nulls at end).

| Param           | Type | Required | Description           |
|-----------------|------|----------|-----------------------|
| `corporationId` | int  | Yes      | NPC corporation ID    |

**Response:** Array of offer results. Each offer includes:

```json
{
  "offerId": 3742,
  "corporationId": 1000125,
  "typeId": 17713,
  "typeName": "Caldari Navy Hookbill",
  "quantity": 1,

  "isBpc": false,
  "bpcTypeId": null,
  "bpcTypeName": null,
  "bpcMaterialCost": null,

  "lpCost": 75000,
  "iskCost": 5000000,
  "requiredItems": [
    {
      "typeId": 17670,
      "typeName": "Caldari Navy Admiral Insignia I",
      "quantity": 5,
      "unitPrice": 4200000,
      "totalCost": 21000000
    }
  ],
  "otherCost": 21000000,
  "logisticsCost": 50000,
  "totalCost": 26050000,

  "bestSellPrice": 85000000,
  "grossSell": 85000000,
  "afterTaxSell": 81770000,

  "profit": 55720000,
  "iskPerLp": 742.93,
  "minSellPrice": 27135000,

  "weeklyVolume": 150,
  "maxWeeklySellUnits": 7,
  "redemptionsAvailable": 12
}
```

**Key fields explained:**

| Field                  | Description                                                           |
|------------------------|-----------------------------------------------------------------------|
| `isBpc`                | True if the LP store gives a Blueprint Copy (manufactured for profit) |
| `bpcMaterialCost`      | Manufacturing material cost per redemption (BPC offers only)          |
| `requiredItems`        | Items you must provide to redeem (tags, insignias, etc.)              |
| `otherCost`            | Sum of `requiredItems[].totalCost`                                    |
| `logisticsCost`        | Hauling cost based on volume and ISK/m3 setting                       |
| `totalCost`            | `iskCost + otherCost + logisticsCost + bpcMaterialCost`               |
| `afterTaxSell`         | Revenue after broker fee + sales tax                                  |
| `profit`               | `afterTaxSell - totalCost` (before LP purchase cost)                  |
| `iskPerLp`             | `profit / lpCost` — the ranking metric                                |
| `minSellPrice`         | Break-even sell price                                                 |
| `maxWeeklySellUnits`   | `weeklyVolume * weeklyVolumePct` — caps how much you can sell         |
| `redemptionsAvailable` | `floor(currentLp / lpCost)` — how many you can do with current LP    |

### `GET /api/lp/history/:corporationId/:offerId`

30-day daily cost breakdown for a specific LP offer. Used for the cost vs. market rate chart.

| Param           | Type | Required | Description        |
|-----------------|------|----------|--------------------|
| `corporationId` | int  | Yes      | NPC corporation ID |
| `offerId`       | int  | Yes      | LP offer ID        |

**Response:**

```json
[
  {
    "date": "2026-02-01",
    "lpCostIsk": 1500000,
    "iskFee": 500000,
    "requiredItemsCost": 250000,
    "mfgCost": 3000000,
    "marketRate": 5000000
  }
]
```

Fields are `null` if market data was unavailable for that day.

---

## LP Rates

User-configured ISK per LP purchase prices for each corporation.

### `GET /api/lp-rates`

Get all rates.

**Response:**

```json
[
  {
    "corporationId": 1000125,
    "corporationName": "Serpentis Corporation",
    "iskPerLp": 3000
  }
]
```

### `PUT /api/lp-rates/:corporationId`

Set the ISK/LP rate for a corporation.

| Param           | Type | Required | Description        |
|-----------------|------|----------|--------------------|
| `corporationId` | int  | Yes      | NPC corporation ID |

**Body:**

```json
{ "iskPerLp": 3000 }
```

Set to `null` to clear. Must be a non-negative number or null.

---

## LP Balances

User-entered LP balance for each corporation (EVE has no API for this).

### `GET /api/lp-balances`

Get all balances.

**Response:**

```json
[
  {
    "corporationId": 1000125,
    "corporationName": "Serpentis Corporation",
    "currentLp": 500000
  }
]
```

### `PUT /api/lp-balances/:corporationId`

Set the LP balance for a corporation.

| Param           | Type | Required | Description        |
|-----------------|------|----------|--------------------|
| `corporationId` | int  | Yes      | NPC corporation ID |

**Body:**

```json
{ "currentLp": 500000 }
```

Set to `null` to clear. Must be a non-negative number or null.

**Errors:** 404 if the corporation is not found in the LP rates collection (ensures the corp exists).

---

## Manufacturing

### `GET /api/manufacturing/:typeId`

Profit breakdown for manufacturing an item from its blueprint.

| Param    | Type | Required | Description               |
|----------|------|----------|---------------------------|
| `typeId` | int  | Yes      | Output item's EVE type ID |

**Response:**

```json
{
  "blueprintTypeId": 17733,
  "activityId": 1,
  "buildTimeSeconds": 18000,

  "outputTypeId": 17732,
  "outputTypeName": "Caldari Navy Hookbill",
  "outputQuantity": 1,

  "materials": [
    {
      "typeId": 34,
      "typeName": "Tritanium",
      "quantity": 50000,
      "unitPrice": 5.2,
      "totalCost": 260000
    }
  ],
  "totalMaterialCost": 12500000,

  "logisticsCost": 25000,
  "totalCost": 12525000,

  "outputSellPrice": 85000000,
  "grossRevenue": 85000000,
  "brokerFee": 1717000,
  "salesTax": 1530000,
  "netRevenue": 81753000,

  "netProfit": 69228000,
  "profitPerUnit": 69228000,
  "profitMarginPct": 81.44
}
```

**Errors:** 404 if no manufacturing blueprint exists for this item.

---

## Settings

Per-character calculation parameters. Requires authentication.

### `GET /api/settings`

**Response:**

```json
{
  "brokerFeePct": 0.0202,
  "salesTaxPct": 0.018,
  "weeklyVolumePct": 0.05,
  "logisticsCostPerM3": 0,
  "sdeBuildNumber": 3231590,
  "sdeReleaseDate": "2026-02-27"
}
```

### `PUT /api/settings`

Update one or more settings.

**Body** (all fields optional):

```json
{
  "brokerFeePct": 0.02,
  "salesTaxPct": 0.015,
  "weeklyVolumePct": 0.05,
  "logisticsCostPerM3": 850
}
```

All values must be non-negative finite numbers. SDE fields (`sdeBuildNumber`, `sdeReleaseDate`) are read-only.

---

## Offer Plans

Track which LP offers you're planning or actively working on. All endpoints require authentication.

### `GET /api/offer-plans?status=<planning|doing>`

Get tracked offers, optionally filtered by status.

| Param    | Type   | Required | Description                    |
|----------|--------|----------|--------------------------------|
| `status` | string | No       | `"planning"` or `"doing"`      |

**Response:**

```json
[
  {
    "corporationId": 1000125,
    "offerId": 3742,
    "typeId": 17713,
    "corporationName": "Serpentis Corporation",
    "typeName": "Caldari Navy Hookbill",
    "status": "doing",
    "addedAt": "2026-02-15T10:30:00.000Z"
  }
]
```

### `PUT /api/offer-plans/:corporationId/:offerId`

Mark an offer as planning or doing (creates if new, updates if exists).

| Param           | Type | Required | Description        |
|-----------------|------|----------|--------------------|
| `corporationId` | int  | Yes      | NPC corporation ID |
| `offerId`       | int  | Yes      | LP offer ID        |

**Body:**

```json
{ "status": "planning" }
```

Must be `"planning"` or `"doing"`.

**Errors:** 404 if the offer doesn't exist in the LP offers collection.

### `DELETE /api/offer-plans/:corporationId/:offerId`

Remove an offer from tracking.

**Response:**

```json
{ "ok": true }
```

**Errors:** 404 if the plan doesn't exist.

---

## Market Depth

Walk the sell order book to find the true cost of buying N units of an item.

### `GET /api/market-depth/:typeId?quantity=N`

| Param      | Type | Required | Description                    |
|------------|------|----------|--------------------------------|
| `typeId`   | int  | Yes      | Item type ID (path param)      |
| `quantity` | int  | Yes      | Units needed (query param)     |

**Response:**

```json
{
  "typeId": 17670,
  "regionId": 10000002,
  "quantityRequested": 50,
  "quantityFilled": 50,
  "totalCost": 26050,
  "weightedAvgPrice": 521,
  "fullyFilled": true,
  "steps": [
    {
      "price": 500,
      "available": 20,
      "qtyUsed": 20,
      "lineCost": 10000
    },
    {
      "price": 520,
      "available": 15,
      "qtyUsed": 15,
      "lineCost": 7800
    },
    {
      "price": 550,
      "available": 15,
      "qtyUsed": 15,
      "lineCost": 8250
    }
  ]
}
```

**Key fields:**

| Field              | Description                                              |
|--------------------|----------------------------------------------------------|
| `quantityFilled`   | May be less than requested if supply is insufficient     |
| `totalCost`        | Sum of all `lineCost` values                             |
| `weightedAvgPrice` | `totalCost / quantityFilled` (quantity-weighted average)  |
| `fullyFilled`      | `false` if available supply < requested quantity         |
| `steps[].available`| Total volume on that order (not just what you'd buy)     |
| `steps[].qtyUsed`  | How many units you'd buy from this specific order        |

**Errors:** 400 if quantity is missing, non-numeric, or not positive.

---

## Sync (Manual Triggers)

Trigger data sync jobs on demand. These are the same operations the cron jobs run automatically.

### `POST /api/sync/market`

Fetch all live market orders for the primary region from ESI.

**Response:**

```json
{ "ok": true, "ordersUpserted": 12500 }
```

Takes 30-60 seconds depending on ESI response time.

### `POST /api/sync/lp-offers`

Fetch LP store offers for all known NPC corporations from ESI.

**Response:**

```json
{ "ok": true, "offersUpserted": 8500 }
```

Processes corps in batches of 10. Skips corps that return 404 (no LP store).

---

## Rate Limiting

All `/api/*` endpoints share a rate limit of **500 requests per 15 minutes per IP address**. When exceeded:

```json
{ "error": "Too many requests, try again later" }
```

HTTP status: 429.
