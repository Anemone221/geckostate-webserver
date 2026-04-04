import { useState, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import DataTable from '../components/DataTable';
import { useAuth } from '../contexts/AuthContext';
import { fmtIsk, fmtDate } from '../lib/formatters';
import {
  useCorpDivisions,
  useCorpOrders,
  useCorpTransactions,
  useCorpJournal,
  useCorpFeeSummary,
  useCorpWithdrawals,
  useCorpTradingSettings,
  useUpdateCorpTradingSettings,
  useTriggerCorpSync,
  useUpdateWithdrawalCategory,
  useCorpLpStorePurchases,
  useUpdateLpStorePurchaseCategory,
  type CorpOrder,
  type InterpretedTransaction,
  type JournalEntry,
  type WithdrawalCategory,
} from '../api/corpTrading';
import { useLpBalances, useLpRates } from '../api/lp';

// ─── Summary card ─────────────────────────────────────────────────────────────

function Card({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: 'green' | 'red' | null;
}) {
  const color =
    highlight === 'green'
      ? 'text-green-400'
      : highlight === 'red'
        ? 'text-red-400'
        : 'text-white';
  return (
    <div className="bg-gray-800 rounded p-3 border border-gray-700">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
    </div>
  );
}

// ─── Scope check banner ──────────────────────────────────────────────────────

const REQUIRED_SCOPE = 'esi-markets.read_corporation_orders.v1';

function ScopeBanner() {
  return (
    <div className="mb-4 px-4 py-3 bg-yellow-900/40 border border-yellow-700 rounded text-yellow-300 text-sm">
      <p className="font-medium">Additional permissions required</p>
      <p className="text-xs mt-1">
        Corporation trading needs ESI scopes for market orders, wallet data, and divisions.
        Click below to re-authorize with the required permissions.
      </p>
      <a
        href="/api/auth/login"
        className="inline-block mt-2 px-3 py-1 bg-yellow-700 hover:bg-yellow-600 text-white text-xs rounded transition-colors"
      >
        Re-authorize with corp scopes
      </a>
    </div>
  );
}

// ─── Orders tab ──────────────────────────────────────────────────────────────

function OrdersTab() {
  const { data: orders, isLoading } = useCorpOrders();

  const columns: ColumnDef<CorpOrder>[] = [
    {
      accessorKey: 'typeName',
      header: 'Item',
      cell: ({ getValue }) => (
        <span className="text-white font-medium">{getValue<string>()}</span>
      ),
    },
    {
      id: 'side',
      header: 'Side',
      accessorFn: (row) => (row.isBuyOrder ? 'Buy' : 'Sell'),
      cell: ({ getValue }) => {
        const v = getValue<string>();
        return (
          <span className={v === 'Buy' ? 'text-green-400' : 'text-red-400'}>
            {v}
          </span>
        );
      },
    },
    {
      accessorKey: 'price',
      header: 'Price',
      cell: ({ getValue }) => fmtIsk(getValue<number>()),
    },
    {
      accessorKey: 'volumeRemain',
      header: 'Remaining',
      cell: ({ getValue }) => getValue<number>().toLocaleString(),
    },
    {
      accessorKey: 'volumeTotal',
      header: 'Total',
      cell: ({ getValue }) => getValue<number>().toLocaleString(),
    },
    {
      id: 'totalIsk',
      header: 'Total ISK',
      accessorFn: (row) => row.price * row.volumeRemain,
      cell: ({ getValue }) => fmtIsk(getValue<number>()),
    },
    {
      accessorKey: 'walletDivision',
      header: 'Wallet',
    },
    {
      accessorKey: 'issued',
      header: 'Issued',
      cell: ({ getValue }) => fmtDate(getValue<string>()),
    },
    {
      id: 'expiry',
      header: 'Expiry',
      accessorFn: (row) => new Date(new Date(row.issued).getTime() + row.duration * 86_400_000).toISOString(),
      cell: ({ getValue }) => fmtDate(getValue<string>()),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={orders ?? []}
      isLoading={isLoading}
      searchable
    />
  );
}

// ─── Transactions tab ────────────────────────────────────────────────────────

function TransactionsTab({ division }: { division: number }) {
  const { data: transactions, isLoading } = useCorpTransactions(division);

  const columns: ColumnDef<InterpretedTransaction>[] = [
    {
      accessorKey: 'date',
      header: 'Date',
      cell: ({ getValue }) => fmtDate(getValue<string>()),
    },
    {
      accessorKey: 'typeName',
      header: 'Item',
      cell: ({ getValue }) => (
        <span className="text-white font-medium">{getValue<string>()}</span>
      ),
    },
    {
      id: 'side',
      header: 'Side',
      accessorFn: (row) => (row.isBuy ? 'Buy' : 'Sell'),
      cell: ({ getValue }) => {
        const v = getValue<string>();
        return (
          <span className={v === 'Buy' ? 'text-green-400' : 'text-red-400'}>
            {v}
          </span>
        );
      },
    },
    {
      accessorKey: 'quantity',
      header: 'Qty',
      cell: ({ getValue }) => getValue<number>().toLocaleString(),
    },
    {
      accessorKey: 'unitPrice',
      header: 'Unit Price',
      cell: ({ getValue }) => fmtIsk(getValue<number>()),
    },
    {
      accessorKey: 'totalIsk',
      header: 'Total ISK',
      cell: ({ getValue }) => fmtIsk(getValue<number>()),
    },
    {
      accessorKey: 'brokerFee',
      header: 'Broker Fee',
      cell: ({ getValue }) => {
        const v = getValue<number | null>();
        return v != null ? (
          <span className="text-red-400">{fmtIsk(v)}</span>
        ) : (
          <span className="text-gray-500">—</span>
        );
      },
    },
    {
      accessorKey: 'salesTax',
      header: 'Sales Tax',
      cell: ({ getValue }) => {
        const v = getValue<number | null>();
        return v != null ? (
          <span className="text-red-400">{fmtIsk(v)}</span>
        ) : (
          <span className="text-gray-500">—</span>
        );
      },
    },
    {
      accessorKey: 'netProfit',
      header: 'Net Profit',
      cell: ({ getValue }) => {
        const v = getValue<number | null>();
        if (v == null) return <span className="text-gray-500">—</span>;
        return (
          <span className={v >= 0 ? 'text-green-400' : 'text-red-400'}>
            {fmtIsk(v)}
          </span>
        );
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={transactions ?? []}
      isLoading={isLoading}
      searchable
    />
  );
}

// ─── Fee Summary tab ─────────────────────────────────────────────────────────

function FeeSummaryTab({ division }: { division: number }) {
  const [days, setDays] = useState(30);
  const [lpSinceDate, setLpSinceDate] = useState('');
  const [withdrawalsOpen, setWithdrawalsOpen] = useState(true);
  const [lpPurchasesOpen, setLpPurchasesOpen] = useState(true);
  const { data: summary, isLoading } = useCorpFeeSummary(division, days);
  const { data: withdrawals, isLoading: wdLoading } = useCorpWithdrawals(division);
  const { data: lpStorePurchases, isLoading: lpLoading } = useCorpLpStorePurchases(division, lpSinceDate || undefined);
  const updateCategory = useUpdateWithdrawalCategory();
  const updateLpStoreCategory = useUpdateLpStorePurchaseCategory();
  const { data: lpBalances } = useLpBalances();
  const { data: lpRates } = useLpRates();

  const heldAssetsValue = useMemo(() => {
    if (!lpBalances || !lpRates) return 0;
    const rateMap = new Map(lpRates.map((r) => [r.corporationId, r.iskPerLp]));
    let total = 0;
    for (const bal of lpBalances) {
      if (bal.currentLp != null && bal.currentLp > 0) {
        const rate = rateMap.get(bal.corporationId);
        if (rate != null && rate > 0) {
          total += bal.currentLp * rate;
        }
      }
    }
    return total;
  }, [lpBalances, lpRates]);

  return (
    <div>
      <div className="flex gap-2 mb-4">
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => { setDays(d); }}
            className={[
              'px-3 py-1 text-sm rounded transition-colors',
              days === d
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600',
            ].join(' ')}
          >
            {d}d
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="animate-pulse h-20 rounded bg-gray-800" />
          ))}
        </div>
      ) : summary ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Card label="Gross Revenue" value={fmtIsk(summary.grossRevenue)} highlight="green" />
          <Card label="Gross Spend" value={fmtIsk(summary.grossSpend)} highlight="red" />
          <Card label="LP Purchases" value={fmtIsk(summary.lpPurchases)} highlight="red" />

          <Card label="Net Revenue" value={fmtIsk(summary.netRevenue)} highlight={summary.netRevenue >= 0 ? 'green' : 'red'} />
          <Card label="Broker Fees" value={fmtIsk(summary.totalBrokerFees)} highlight="red" />
          <Card label="Sales Tax" value={fmtIsk(summary.totalSalesTax)} highlight="red" />

          <Card label="Industry Costs" value={fmtIsk(summary.industryCosts)} highlight="red" />

          <Card label="Profit" value={fmtIsk(summary.profit)} highlight={summary.profit >= 0 ? 'green' : 'red'} />
          <Card label="Potential Profit" value={fmtIsk(summary.potentialProfit)} highlight={summary.potentialProfit >= 0 ? 'green' : 'red'} />
          <Card label="Potential Sales Tax" value={fmtIsk(summary.potentialSalesTax)} highlight="red" />

          <Card label="Held Assets (LP)" value={fmtIsk(heldAssetsValue)} highlight="green" />
          {summary.miscWithdrawals > 0 && (
            <Card label="Misc Withdrawals" value={fmtIsk(summary.miscWithdrawals)} highlight="red" />
          )}
        </div>
      ) : (
        <p className="text-gray-500 text-sm">No data available. Try syncing first.</p>
      )}

      {/* Corporation Account Withdrawals — toggle which ones count as LP purchases */}
      <div className="mt-6">
        <button
          onClick={() => setWithdrawalsOpen(!withdrawalsOpen)}
          className="flex items-center gap-2 text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2 hover:text-gray-200 transition-colors"
        >
          <span className={`transition-transform ${withdrawalsOpen ? 'rotate-0' : '-rotate-90'}`}>▼</span>
          Corporation Withdrawals
        </button>
        {withdrawalsOpen && (
          <>
            <p className="text-xs text-gray-500 mb-3">
              Check the entries that are LP purchases. Unchecked entries are excluded from the LP Purchases total above.
            </p>
            {wdLoading ? (
              <div className="animate-pulse h-20 rounded bg-gray-800" />
            ) : withdrawals && withdrawals.length > 0 ? (
              <div className="bg-gray-800 rounded border border-gray-700 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700 text-gray-400 text-xs uppercase">
                      <th className="px-3 py-2 text-left">Category</th>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2 text-left">Description</th>
                      <th className="px-3 py-2 text-left">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {withdrawals.map((w) => {
                      const cat = w.category ?? (w.isLpPurchase === false ? 'other' : 'lp_purchase');
                      return (
                        <tr key={`${w.journalId}-${w.division}`} className="border-b border-gray-700/50 last:border-0">
                          <td className="px-3 py-1.5">
                            <select
                              value={cat}
                              onChange={(e) => {
                                void updateCategory.mutateAsync({
                                  journalId: w.journalId,
                                  division: w.division,
                                  category: e.target.value as WithdrawalCategory,
                                });
                              }}
                              className="px-1.5 py-0.5 text-xs bg-gray-700 border border-gray-600 rounded text-gray-200 focus:outline-none focus:border-indigo-500"
                            >
                              <option value="lp_purchase">LP Purchase</option>
                              <option value="private_sale">Private Sale</option>
                              <option value="investor_payout">Investor Payout</option>
                              <option value="other">Other</option>
                            </select>
                          </td>
                          <td className="px-3 py-1.5 text-gray-300">{fmtDate(w.date)}</td>
                          <td className={`px-3 py-1.5 text-right ${w.amount >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtIsk(w.amount)}</td>
                          <td className="px-3 py-1.5 text-gray-400 text-xs">{w.description}</td>
                          <td className="px-3 py-1.5 text-gray-400 text-xs">{w.reason}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No withdrawal entries found.</p>
            )}
          </>
        )}
      </div>

      {/* LP Store Purchases — direct payments to LP Store */}
      <div className="mt-6">
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={() => setLpPurchasesOpen(!lpPurchasesOpen)}
            className="flex items-center gap-2 text-sm font-semibold text-gray-400 uppercase tracking-wide hover:text-gray-200 transition-colors"
          >
            <span className={`transition-transform ${lpPurchasesOpen ? 'rotate-0' : '-rotate-90'}`}>▼</span>
            LP Store Purchases
          </button>
          {lpPurchasesOpen && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">Since:</label>
              <input
                type="date"
                value={lpSinceDate}
                onChange={(e) => { setLpSinceDate(e.target.value); }}
                className="px-2 py-1 text-xs bg-gray-800 border border-gray-600 rounded text-gray-100 focus:outline-none focus:border-indigo-500"
              />
              {lpSinceDate && (
                <button
                  onClick={() => { setLpSinceDate(''); }}
                  className="text-xs text-gray-500 hover:text-gray-300"
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </div>
        {lpPurchasesOpen && (
          <>
            <p className="text-xs text-gray-500 mb-3">
              Direct LP Store payments. Use the category dropdown to classify each entry.
            </p>
            {lpLoading ? (
              <div className="animate-pulse h-20 rounded bg-gray-800" />
            ) : lpStorePurchases && lpStorePurchases.length > 0 ? (
              <div className="bg-gray-800 rounded border border-gray-700 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700 text-gray-400 text-xs uppercase">
                      <th className="px-3 py-2 text-left">Category</th>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2 text-left">Description</th>
                      <th className="px-3 py-2 text-left">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lpStorePurchases.map((w) => {
                      const cat = w.category ?? (w.isLpPurchase === false ? 'other' : 'lp_purchase');
                      return (
                        <tr key={`${w.journalId}-${w.division}`} className="border-b border-gray-700/50 last:border-0">
                          <td className="px-3 py-1.5">
                            <select
                              value={cat}
                              onChange={(e) => {
                                void updateLpStoreCategory.mutateAsync({
                                  journalId: w.journalId,
                                  division: w.division,
                                  category: e.target.value as WithdrawalCategory,
                                });
                              }}
                              className="px-1.5 py-0.5 text-xs bg-gray-700 border border-gray-600 rounded text-gray-200 focus:outline-none focus:border-indigo-500"
                            >
                              <option value="lp_purchase">LP Purchase</option>
                              <option value="private_sale">Private Sale</option>
                              <option value="investor_payout">Investor Payout</option>
                              <option value="other">Other</option>
                            </select>
                          </td>
                          <td className="px-3 py-1.5 text-gray-300">{fmtDate(w.date)}</td>
                          <td className={`px-3 py-1.5 text-right ${w.amount >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtIsk(w.amount)}</td>
                          <td className="px-3 py-1.5 text-gray-400 text-xs">{w.description}</td>
                          <td className="px-3 py-1.5 text-gray-400 text-xs">{w.reason}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No LP store purchase entries found.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Journal tab ─────────────────────────────────────────────────────────────

function JournalTab({ division }: { division: number }) {
  const { data: entries, isLoading } = useCorpJournal(division);

  const columns: ColumnDef<JournalEntry>[] = [
    {
      accessorKey: 'date',
      header: 'Date',
      cell: ({ getValue }) => fmtDate(getValue<string>()),
    },
    {
      accessorKey: 'refType',
      header: 'Type',
      cell: ({ getValue }) => (
        <span className="text-gray-300">{getValue<string>().replace(/_/g, ' ')}</span>
      ),
    },
    {
      accessorKey: 'amount',
      header: 'Amount',
      cell: ({ getValue }) => {
        const v = getValue<number>();
        return (
          <span className={v >= 0 ? 'text-green-400' : 'text-red-400'}>
            {fmtIsk(v)}
          </span>
        );
      },
    },
    {
      accessorKey: 'balance',
      header: 'Balance',
      cell: ({ getValue }) => fmtIsk(getValue<number>()),
    },
    {
      accessorKey: 'description',
      header: 'Description',
      cell: ({ getValue }) => (
        <span className="text-gray-400 text-xs">{getValue<string>()}</span>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={entries ?? []}
      isLoading={isLoading}
      searchable
    />
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

type Tab = 'orders' | 'transactions' | 'fees' | 'journal';

export default function CorpTrading() {
  const { character } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('fees');
  const [division, setDivision] = useState(1);

  const { data: divisions } = useCorpDivisions();
  const { data: settings } = useCorpTradingSettings();
  const queryClient = useQueryClient();
  const updateSettings = useUpdateCorpTradingSettings();
  const syncMutation = useTriggerCorpSync();

  // Load saved division from settings on mount
  useEffect(() => {
    if (settings?.walletDivision) {
      setDivision(settings.walletDivision);
    }
  }, [settings?.walletDivision]);

  // Check if the character has the required scopes
  const hasScopes = character?.scopes?.includes(REQUIRED_SCOPE) ?? false;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'orders', label: 'Orders' },
    { key: 'transactions', label: 'Transactions' },
    { key: 'fees', label: 'Fee Summary' },
    { key: 'journal', label: 'Journal' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-white">Corp Trading</h1>
          <p className="text-gray-400 text-sm">
            Corporation market orders, wallet transactions, and fee analysis.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Division selector */}
          <select
            value={division}
            onChange={(e) => {
              const newDiv = parseInt(e.target.value);
              setDivision(newDiv);
              updateSettings.mutate({ walletDivision: newDiv });
            }}
            className="px-2 py-1.5 text-sm bg-gray-800 border border-gray-600 rounded text-gray-100 focus:outline-none focus:border-indigo-500"
          >
            {(divisions ?? []).map((d) => (
              <option key={d.division} value={d.division}>
                {d.name}
              </option>
            ))}
          </select>

          {/* Refresh from DB (no ESI calls) */}
          <button
            onClick={() => { void queryClient.invalidateQueries({ queryKey: ['corp-trading'] }); }}
            className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
          >
            Refresh
          </button>

          {/* Sync from ESI */}
          <button
            onClick={() => { void syncMutation.mutateAsync(); }}
            disabled={syncMutation.isPending || !hasScopes}
            className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded transition-colors"
          >
            {syncMutation.isPending ? 'Syncing...' : 'Sync Now'}
          </button>
        </div>
      </div>

      {!hasScopes && <ScopeBanner />}

      {/* Tab bar */}
      <div className="flex gap-1 mb-4 border-b border-gray-700">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); }}
            className={[
              'px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
              activeTab === tab.key
                ? 'border-indigo-500 text-white'
                : 'border-transparent text-gray-400 hover:text-gray-200',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'orders' && <OrdersTab />}
      {activeTab === 'transactions' && <TransactionsTab division={division} />}
      {activeTab === 'fees' && <FeeSummaryTab division={division} />}
      {activeTab === 'journal' && <JournalTab division={division} />}

      {/* Sync result toast */}
      {syncMutation.isSuccess && (
        <div className="fixed bottom-4 right-4 bg-green-900 border border-green-700 text-green-300 text-sm px-4 py-2 rounded shadow-lg">
          Synced: {syncMutation.data.synced.orders} orders, {syncMutation.data.synced.transactions} transactions, {syncMutation.data.synced.journal} journal entries
        </div>
      )}

      {syncMutation.isError && (
        <div className="fixed bottom-4 right-4 bg-red-900 border border-red-700 text-red-300 text-sm px-4 py-2 rounded shadow-lg">
          Sync failed: {syncMutation.error instanceof Error ? syncMutation.error.message : 'Unknown error'}
        </div>
      )}
    </div>
  );
}
