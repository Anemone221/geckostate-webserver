// corp-trading.test.ts
// Tests for corporation trading API routes and interpretation service.
//
// What's tested:
//   - Auth protection on all corp-trading endpoints (401 without login)
//   - GET /divisions returns default divisions or synced ones
//   - GET /orders returns corp orders for the character's corporation
//   - GET /transactions returns interpreted transactions with matched fees
//   - GET /journal returns raw journal entries
//   - GET /fee-summary returns aggregated fee breakdown
//   - GET /settings and PUT /settings for corp trading config
//   - POST /sync triggers all sync functions and returns counts
//   - Interpretation: transaction→journal matching and fee calculation
//   - Fee summary: broker fees, sales tax, relist costs, net revenue

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { loginAgent, TEST_CHARACTER_ID, TEST_CORP_ID, seedItems } from './seed';

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Mock SSO service (standard pattern — prevents real HTTP calls to CCP)
vi.mock('../services/sso.service', async () => (await import('./seed')).createSsoMock());

// Mock token service — return a dummy access token instead of refreshing
vi.mock('../services/token.service', async () => (await import('./seed')).createTokenMock());

// Mock axios — syncCorpTransactions calls axios.get directly for from_id pagination
const mockTransactions = [
  {
    transaction_id:  3001,
    date:            '2025-01-15T12:00:30Z',
    type_id:         100,
    quantity:        5,
    unit_price:      1_000_000,
    client_id:       99999,
    location_id:     60003760,
    is_buy:          false,
    journal_ref_id:  7001,
  },
  {
    transaction_id:  3002,
    date:            '2025-01-15T11:00:00Z',
    type_id:         100,
    quantity:        10,
    unit_price:      900_000,
    client_id:       88888,
    location_id:     60003760,
    is_buy:          true,
    journal_ref_id:  7004,
  },
];
const txSeenUrls = new Set<string>();
vi.mock('axios', () => ({
  default: {
    get: vi.fn().mockImplementation((url: string, opts?: { params?: Record<string, unknown> }) => {
      if (url.includes('/transactions/')) {
        // First call per division returns data; from_id calls return empty (end of history)
        if (opts?.params?.['from_id']) {
          return Promise.resolve({ data: [], headers: {} });
        }
        if (!txSeenUrls.has(url)) {
          txSeenUrls.add(url);
          return Promise.resolve({ data: mockTransactions, headers: {} });
        }
        return Promise.resolve({ data: [], headers: {} });
      }
      return Promise.resolve({ data: [], headers: {} });
    }),
  },
}));

// Mock ESI authenticated calls — return canned responses instead of calling ESI
vi.mock('../services/esi.service', () => ({
  // Keep existing public ESI functions as pass-throughs (not used in these tests)
  esiGet: vi.fn().mockResolvedValue(null),
  esiGetPaginated: vi.fn().mockResolvedValue([]),

  // Authenticated ESI calls used by corp-trading-sync.service
  esiAuthGet: vi.fn().mockResolvedValue({
    wallet: [
      { division: 1, name: 'Master Wallet' },
      { division: 2, name: 'Trading' },
      { division: 3, name: 'Industry' },
    ],
    hangar: [
      { division: 1, name: 'Main Hangar' },
    ],
  }),
  esiAuthGetPaginated: vi.fn().mockImplementation((path: string) => {
    // Corp orders endpoint
    if (path.includes('/orders/')) {
      return Promise.resolve([
        {
          order_id:        5001,
          type_id:         100,
          region_id:       10000002,
          location_id:     60003760,
          price:           1_000_000,
          volume_remain:   50,
          volume_total:    100,
          is_buy_order:    false,
          issued:          '2025-01-15T12:00:00Z',
          duration:        90,
          min_volume:      1,
          range:           'region',
          escrow:          null,
          wallet_division: 1,
          issued_by:       TEST_CHARACTER_ID,
        },
        {
          order_id:        5002,
          type_id:         100,
          region_id:       10000002,
          location_id:     60003760,
          price:           900_000,
          volume_remain:   200,
          volume_total:    200,
          is_buy_order:    true,
          issued:          '2025-01-15T13:00:00Z',
          duration:        90,
          min_volume:      1,
          range:           'region',
          escrow:          180_000_000,
          wallet_division: 1,
          issued_by:       TEST_CHARACTER_ID,
        },
      ]);
    }
    // Journal endpoint
    if (path.includes('/journal/')) {
      return Promise.resolve([
        {
          id:               7001,
          date:             '2025-01-15T12:01:00Z',
          ref_type:         'market_transaction',
          amount:           5_000_000,
          balance:          100_000_000,
          first_party_id:   TEST_CHARACTER_ID,
          second_party_id:  99999,
          description:      'Market: Test LP Output sold',
          context_id:       5001,
          context_id_type:  'market_transaction_id',
          reason:           '',
        },
        {
          id:               7002,
          date:             '2025-01-15T12:01:01Z',
          ref_type:         'brokers_fee',
          amount:           -25_000,
          balance:          99_975_000,
          first_party_id:   TEST_CHARACTER_ID,
          description:      'Broker fee',
          context_id:       5001,
          context_id_type:  'market_transaction_id',
          reason:           '',
        },
        {
          id:               7003,
          date:             '2025-01-15T12:01:02Z',
          ref_type:         'transaction_tax',
          amount:           -50_000,
          balance:          99_925_000,
          first_party_id:   TEST_CHARACTER_ID,
          description:      'Transaction tax',
          context_id:       5001,
          context_id_type:  'market_transaction_id',
          reason:           '',
        },
      ]);
    }
    return Promise.resolve([]);
  }),
}));

// ─── Setup ──────────────────────────────────────────────────────────────────

const app = createApp();
let agent: ReturnType<typeof request.agent>;
let accountId: string;

// Import models for direct DB seeding in some tests
import { Character } from '../models/character.model';
import { CorpOrder } from '../models/corp-order.model';
import { CorpDivision } from '../models/corp-division.model';
import { CorpTradingSettings } from '../models/corp-trading-settings.model';
import { WalletTransaction } from '../models/wallet-transaction.model';
import { WalletJournal } from '../models/wallet-journal.model';

/**
 * Set the character's corporationId in the DB (simulates having logged in
 * with ESI and fetched the corp ID from the public endpoint).
 */
async function setCharacterCorpId(corpId: number): Promise<void> {
  await Character.findOneAndUpdate(
    { characterId: TEST_CHARACTER_ID },
    { $set: { corporationId: corpId } }
  );
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Corp Trading API', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    txSeenUrls.clear();

    // Login and set corp ID on the character
    const auth = await loginAgent(app);
    agent = auth.agent;
    accountId = auth.accountId;
    await setCharacterCorpId(TEST_CORP_ID);

    // Seed item names (used by interpretation service)
    await seedItems();
  });

  // ── Auth protection ───────────────────────────────────────────────────────

  describe('Auth protection', () => {
    const protectedEndpoints = [
      ['GET',  '/api/corp-trading/divisions'],
      ['GET',  '/api/corp-trading/orders'],
      ['GET',  '/api/corp-trading/transactions'],
      ['GET',  '/api/corp-trading/journal'],
      ['GET',  '/api/corp-trading/fee-summary'],
      ['GET',  '/api/corp-trading/settings'],
      ['PUT',  '/api/corp-trading/settings'],
      ['POST', '/api/corp-trading/sync'],
    ] as const;

    for (const [method, path] of protectedEndpoints) {
      it(`${method} ${path} returns 401 when not logged in`, async () => {
        const req = method === 'GET'
          ? request(app).get(path)
          : method === 'PUT'
            ? request(app).put(path).send({})
            : request(app).post(path);

        const res = await req;
        expect(res.status).toBe(401);
      });
    }
  });

  // ── GET /divisions ────────────────────────────────────────────────────────

  describe('GET /api/corp-trading/divisions', () => {
    it('returns default divisions (1-7) when none synced yet', async () => {
      const res = await agent.get('/api/corp-trading/divisions');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(7);
      expect(res.body[0]).toEqual({ division: 1, name: 'Division 1' });
      expect(res.body[6]).toEqual({ division: 7, name: 'Division 7' });
    });

    it('returns synced wallet divisions when available', async () => {
      // Seed some synced divisions
      await CorpDivision.insertMany([
        { corporationId: TEST_CORP_ID, division: 1, name: 'Master Wallet', isWallet: true },
        { corporationId: TEST_CORP_ID, division: 2, name: 'Trading',       isWallet: true },
        // Hangar division should NOT appear (isWallet: false)
        { corporationId: TEST_CORP_ID, division: 1, name: 'Main Hangar',   isWallet: false },
      ]);

      const res = await agent.get('/api/corp-trading/divisions');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].name).toBe('Master Wallet');
      expect(res.body[1].name).toBe('Trading');
    });
  });

  // ── GET /orders ───────────────────────────────────────────────────────────

  describe('GET /api/corp-trading/orders', () => {
    it('returns empty array when no orders exist', async () => {
      const res = await agent.get('/api/corp-trading/orders');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns corp orders for the character corporation', async () => {
      // Seed some corp orders
      await CorpOrder.insertMany([
        {
          orderId: 5001, corporationId: TEST_CORP_ID, characterId: TEST_CHARACTER_ID,
          typeId: 100, locationId: 60003760, regionId: 10000002,
          price: 1_000_000, volumeRemain: 50, volumeTotal: 100,
          isBuyOrder: false, issued: new Date('2025-01-15'), duration: 90,
          minVolume: 1, range: 'region', escrow: null, walletDivision: 1,
          snapshotTime: new Date(),
        },
        {
          orderId: 5002, corporationId: TEST_CORP_ID, characterId: TEST_CHARACTER_ID,
          typeId: 100, locationId: 60003760, regionId: 10000002,
          price: 900_000, volumeRemain: 200, volumeTotal: 200,
          isBuyOrder: true, issued: new Date('2025-01-15'), duration: 90,
          minVolume: 1, range: 'region', escrow: 180_000_000, walletDivision: 1,
          snapshotTime: new Date(),
        },
      ]);

      const res = await agent.get('/api/corp-trading/orders');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);

      // Verify sell order
      const sellOrder = res.body.find((o: { orderId: number }) => o.orderId === 5001);
      expect(sellOrder).toBeDefined();
      expect(sellOrder.price).toBe(1_000_000);
      expect(sellOrder.isBuyOrder).toBe(false);
      expect(sellOrder.volumeRemain).toBe(50);

      // Verify buy order
      const buyOrder = res.body.find((o: { orderId: number }) => o.orderId === 5002);
      expect(buyOrder).toBeDefined();
      expect(buyOrder.isBuyOrder).toBe(true);
      expect(buyOrder.escrow).toBe(180_000_000);
    });

    it('only returns orders for the character corporation (not others)', async () => {
      await CorpOrder.insertMany([
        {
          orderId: 5001, corporationId: TEST_CORP_ID, characterId: TEST_CHARACTER_ID,
          typeId: 100, locationId: 60003760, regionId: 10000002,
          price: 1_000_000, volumeRemain: 50, volumeTotal: 100,
          isBuyOrder: false, issued: new Date(), duration: 90,
          minVolume: 1, range: 'region', escrow: null, walletDivision: 1,
          snapshotTime: new Date(),
        },
        {
          orderId: 9999, corporationId: 999999, characterId: 111,
          typeId: 200, locationId: 60003760, regionId: 10000002,
          price: 500_000, volumeRemain: 10, volumeTotal: 10,
          isBuyOrder: false, issued: new Date(), duration: 90,
          minVolume: 1, range: 'region', escrow: null, walletDivision: 1,
          snapshotTime: new Date(),
        },
      ]);

      const res = await agent.get('/api/corp-trading/orders');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].orderId).toBe(5001);
    });
  });

  // ── GET /transactions ─────────────────────────────────────────────────────

  describe('GET /api/corp-trading/transactions', () => {
    it('returns empty array when no transactions exist', async () => {
      const res = await agent.get('/api/corp-trading/transactions?division=1');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns interpreted transactions with matched fees', async () => {
      // Seed a sell transaction + matching journal entries
      await WalletTransaction.create({
        transactionId: 3001, corporationId: TEST_CORP_ID, division: 1,
        date: new Date('2025-01-15T12:00:30Z'),
        typeId: 100, quantity: 5, unitPrice: 1_000_000,
        clientId: 99999, locationId: 60003760,
        isBuy: false, journalRefId: 7001,
      });

      // The market_transaction journal entry (referenced by journalRefId)
      await WalletJournal.insertMany([
        {
          journalId: 7001, corporationId: TEST_CORP_ID, division: 1,
          date: new Date('2025-01-15T12:01:00Z'),
          refType: 'market_transaction', amount: 5_000_000, balance: 100_000_000,
          firstPartyId: TEST_CHARACTER_ID, secondPartyId: 99999,
          description: 'Market: Test LP Output sold',
          contextId: 5001, contextIdType: 'market_transaction_id', reason: '',
        },
        // Broker fee matched by contextId
        {
          journalId: 7002, corporationId: TEST_CORP_ID, division: 1,
          date: new Date('2025-01-15T12:01:01Z'),
          refType: 'brokers_fee', amount: -25_000, balance: 99_975_000,
          firstPartyId: TEST_CHARACTER_ID,
          description: 'Broker fee',
          contextId: 5001, contextIdType: 'market_transaction_id', reason: '',
        },
        // Sales tax matched by contextId
        {
          journalId: 7003, corporationId: TEST_CORP_ID, division: 1,
          date: new Date('2025-01-15T12:01:02Z'),
          refType: 'transaction_tax', amount: -50_000, balance: 99_925_000,
          firstPartyId: TEST_CHARACTER_ID,
          description: 'Transaction tax',
          contextId: 5001, contextIdType: 'market_transaction_id', reason: '',
        },
      ]);

      const res = await agent.get('/api/corp-trading/transactions?division=1&limit=10');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);

      const tx = res.body[0];
      expect(tx.transactionId).toBe(3001);
      expect(tx.typeId).toBe(100);
      expect(tx.typeName).toBe('Test LP Output'); // resolved from SDE items
      expect(tx.quantity).toBe(5);
      expect(tx.unitPrice).toBe(1_000_000);
      expect(tx.totalIsk).toBe(5_000_000);        // 5 × 1,000,000
      expect(tx.isBuy).toBe(false);
      expect(tx.brokerFee).toBe(25_000);
      expect(tx.salesTax).toBe(50_000);
      // netProfit = totalIsk - brokerFee - salesTax = 5,000,000 - 25,000 - 50,000 = 4,925,000
      expect(tx.netProfit).toBe(4_925_000);
    });

    it('returns null fees for buy transactions (net profit not applicable)', async () => {
      await WalletTransaction.create({
        transactionId: 3002, corporationId: TEST_CORP_ID, division: 1,
        date: new Date('2025-01-15T11:00:00Z'),
        typeId: 100, quantity: 10, unitPrice: 900_000,
        clientId: 88888, locationId: 60003760,
        isBuy: true, journalRefId: 7004,
      });

      const res = await agent.get('/api/corp-trading/transactions?division=1');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);

      const tx = res.body[0];
      expect(tx.isBuy).toBe(true);
      expect(tx.totalIsk).toBe(9_000_000); // 10 × 900,000
      expect(tx.netProfit).toBeNull();      // no net profit for buys
    });
  });

  // ── GET /journal ──────────────────────────────────────────────────────────

  describe('GET /api/corp-trading/journal', () => {
    it('returns empty array when no journal entries exist', async () => {
      const res = await agent.get('/api/corp-trading/journal?division=1');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns journal entries sorted by date descending', async () => {
      await WalletJournal.insertMany([
        {
          journalId: 7001, corporationId: TEST_CORP_ID, division: 1,
          date: new Date('2025-01-15T12:01:00Z'),
          refType: 'market_transaction', amount: 5_000_000, balance: 100_000_000,
          description: 'Sold items', reason: '',
        },
        {
          journalId: 7002, corporationId: TEST_CORP_ID, division: 1,
          date: new Date('2025-01-15T12:02:00Z'),
          refType: 'brokers_fee', amount: -25_000, balance: 99_975_000,
          description: 'Broker fee', reason: '',
        },
      ]);

      const res = await agent.get('/api/corp-trading/journal?division=1');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      // Most recent first
      expect(res.body[0].journalId).toBe(7002);
      expect(res.body[1].journalId).toBe(7001);
    });

    it('respects the limit parameter', async () => {
      await WalletJournal.insertMany(
        Array.from({ length: 5 }, (_, i) => ({
          journalId: 8000 + i, corporationId: TEST_CORP_ID, division: 1,
          date: new Date(Date.now() - i * 60000),
          refType: 'market_transaction', amount: 1000, balance: 1000,
          description: '', reason: '',
        }))
      );

      const res = await agent.get('/api/corp-trading/journal?division=1&limit=3');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
    });
  });

  // ── GET /fee-summary ──────────────────────────────────────────────────────

  describe('GET /api/corp-trading/fee-summary', () => {
    it('returns zero summary when no data exists', async () => {
      const res = await agent.get('/api/corp-trading/fee-summary?division=1&days=30');
      expect(res.status).toBe(200);
      expect(res.body.totalBrokerFees).toBe(0);
      expect(res.body.totalSalesTax).toBe(0);
      expect(res.body.grossRevenue).toBe(0);
      expect(res.body.grossSpend).toBe(0);
      expect(res.body.profit).toBe(0);
      expect(res.body.periodDays).toBe(30);
    });

    it('calculates correct fee breakdown from journal + transactions', async () => {
      const now = new Date();

      // Seed journal entries: broker fees + sales tax
      await WalletJournal.insertMany([
        {
          journalId: 9001, corporationId: TEST_CORP_ID, division: 1,
          date: now, refType: 'brokers_fee', amount: -100_000, balance: 0,
          description: '', reason: '',
          contextId: 99999, // not matching any existing order → initial listing fee
        },
        {
          journalId: 9002, corporationId: TEST_CORP_ID, division: 1,
          date: now, refType: 'transaction_tax', amount: -200_000, balance: 0,
          description: '', reason: '',
          contextId: 99998,
        },
      ]);

      // Seed transactions: 1 sell + 1 buy
      await WalletTransaction.insertMany([
        {
          transactionId: 4001, corporationId: TEST_CORP_ID, division: 1,
          date: now, typeId: 100, quantity: 10, unitPrice: 1_000_000,
          clientId: 99999, locationId: 60003760,
          isBuy: false, journalRefId: 9001,
        },
        {
          transactionId: 4002, corporationId: TEST_CORP_ID, division: 1,
          date: now, typeId: 100, quantity: 5, unitPrice: 800_000,
          clientId: 88888, locationId: 60003760,
          isBuy: true, journalRefId: 9003,
        },
      ]);

      const res = await agent.get('/api/corp-trading/fee-summary?division=1&days=30');
      expect(res.status).toBe(200);

      // Broker fees: 100,000 (abs of -100,000)
      expect(res.body.totalBrokerFees).toBe(100_000);
      // Sales tax: 200,000 (abs of -200,000)
      expect(res.body.totalSalesTax).toBe(200_000);
      // Gross revenue: 10 × 1,000,000 = 10,000,000
      expect(res.body.grossRevenue).toBe(10_000_000);
      // Gross spend: 5 × 800,000 = 4,000,000
      expect(res.body.grossSpend).toBe(4_000_000);
      // Profit: 10,000,000 - 4,000,000 - 0 - 100,000 - 200,000 = 5,700,000
      expect(res.body.profit).toBe(5_700_000);
    });

    it('counts all broker fees together regardless of contextId', async () => {
      const now = new Date();

      // Seed two broker fee entries — one with a contextId matching an order, one without
      await WalletJournal.insertMany([
        {
          journalId: 9010, corporationId: TEST_CORP_ID, division: 1,
          date: now, refType: 'brokers_fee', amount: -75_000, balance: 0,
          description: 'Broker relist', reason: '',
          contextId: 6001,
        },
        {
          journalId: 9011, corporationId: TEST_CORP_ID, division: 1,
          date: now, refType: 'brokers_fee', amount: -25_000, balance: 0,
          description: 'Broker new', reason: '',
          contextId: 99999,
        },
      ]);

      const res = await agent.get('/api/corp-trading/fee-summary?division=1&days=30');
      expect(res.status).toBe(200);
      // Both broker fees combined: 75,000 + 25,000 = 100,000
      expect(res.body.totalBrokerFees).toBe(100_000);
    });
  });

  // ── GET /settings ─────────────────────────────────────────────────────────

  describe('GET /api/corp-trading/settings', () => {
    it('returns defaults when no settings exist', async () => {
      const res = await agent.get('/api/corp-trading/settings');
      expect(res.status).toBe(200);
      expect(res.body.corporationId).toBe(0);
      expect(res.body.walletDivision).toBe(1);
      expect(res.body.lastOrderSync).toBeNull();
    });

    it('returns saved settings', async () => {
      await CorpTradingSettings.create({
        accountId,
        corporationId: TEST_CORP_ID,
        walletDivision: 3,
        lastOrderSync: new Date('2025-01-15'),
      });

      const res = await agent.get('/api/corp-trading/settings');
      expect(res.status).toBe(200);
      expect(res.body.corporationId).toBe(TEST_CORP_ID);
      expect(res.body.walletDivision).toBe(3);
    });
  });

  // ── PUT /settings ─────────────────────────────────────────────────────────

  describe('PUT /api/corp-trading/settings', () => {
    it('updates wallet division', async () => {
      const res = await agent
        .put('/api/corp-trading/settings')
        .send({ walletDivision: 5 });

      expect(res.status).toBe(200);
      expect(res.body.walletDivision).toBe(5);

      // Verify it persisted
      const settings = await CorpTradingSettings.findOne({ accountId });
      expect(settings!.walletDivision).toBe(5);
    });

    it('rejects invalid wallet division', async () => {
      const res = await agent
        .put('/api/corp-trading/settings')
        .send({ walletDivision: 9 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('walletDivision');
    });

    it('rejects wallet division 0', async () => {
      const res = await agent
        .put('/api/corp-trading/settings')
        .send({ walletDivision: 0 });

      expect(res.status).toBe(400);
    });
  });

  // ── POST /sync ────────────────────────────────────────────────────────────

  describe('POST /api/corp-trading/sync', () => {
    it('triggers sync and returns counts', async () => {
      const res = await agent.post('/api/corp-trading/sync');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.synced).toHaveProperty('orders');
      expect(res.body.synced).toHaveProperty('transactions');
      expect(res.body.synced).toHaveProperty('journal');

      // After sync, orders should be in the DB
      expect(res.body.synced.orders).toBeGreaterThan(0);
    });

    it('updates sync timestamps after successful sync', async () => {
      await agent.post('/api/corp-trading/sync');

      const settings = await CorpTradingSettings.findOne({ accountId });
      expect(settings).toBeDefined();
      expect(settings!.lastOrderSync).toBeDefined();
      expect(settings!.lastTransactionSync).toBeDefined();
      expect(settings!.lastJournalSync).toBeDefined();
    });

    it('syncs divisions into the database', async () => {
      await agent.post('/api/corp-trading/sync');

      // The mock esiAuthGet returns 3 wallet divisions and 1 hangar division
      const walletDivs = await CorpDivision.find({
        corporationId: TEST_CORP_ID,
        isWallet: true,
      });
      expect(walletDivs).toHaveLength(3);
      expect(walletDivs.find((d) => d.division === 1)!.name).toBe('Master Wallet');

      const hangarDivs = await CorpDivision.find({
        corporationId: TEST_CORP_ID,
        isWallet: false,
      });
      expect(hangarDivs).toHaveLength(1);
    });

    it('syncs orders into the database', async () => {
      await agent.post('/api/corp-trading/sync');

      const orders = await CorpOrder.find({ corporationId: TEST_CORP_ID });
      expect(orders).toHaveLength(2);

      const sellOrder = orders.find((o) => o.orderId === 5001);
      expect(sellOrder!.price).toBe(1_000_000);
      expect(sellOrder!.isBuyOrder).toBe(false);
    });

    it('syncs transactions into the database', async () => {
      await agent.post('/api/corp-trading/sync');

      // Sync loops all 7 divisions; mock returns 2 transactions per division.
      // Each division creates its own records (keyed by transactionId + division).
      const txs = await WalletTransaction.find({ corporationId: TEST_CORP_ID });
      expect(txs).toHaveLength(2 * 7);
      // Verify data integrity for division 1
      const div1Tx = txs.find((t) => t.transactionId === 3001 && t.division === 1);
      expect(div1Tx!.unitPrice).toBe(1_000_000);
    });

    it('syncs journal entries into the database', async () => {
      await agent.post('/api/corp-trading/sync');

      // Sync loops all 7 divisions; mock returns 3 journal entries per division.
      const entries = await WalletJournal.find({ corporationId: TEST_CORP_ID });
      expect(entries).toHaveLength(3 * 7);
      // Verify data integrity for division 1
      const div1Entry = entries.find((e) => e.journalId === 7002 && e.division === 1);
      expect(div1Entry!.refType).toBe('brokers_fee');
    });
  });
});
