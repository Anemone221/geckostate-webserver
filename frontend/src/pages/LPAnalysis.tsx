import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { type ColumnDef } from '@tanstack/react-table';
import DataTable from '../components/DataTable';
import ExportToolbar from '../components/ExportToolbar';
import CostBreakdownChart from '../components/charts/CostBreakdownChart';
import {
  useLpCorps, useLpAnalysis, useLpRates, useLpBalances,
  useUpdateLpRate, useUpdateLpBalance, type LpOffer,
} from '../api/lp';
import { useOfferPlans, useUpsertOfferPlan, useDeleteOfferPlan } from '../api/offerPlans';
import { calcWeekly, fmtIsk, fmtNum } from '../lib/lpCalc';

// ─── Corp picker (/lp) ────────────────────────────────────────────────────────

function CorpPicker() {
  const { data: corps,    isLoading: corpsLoading }   = useLpCorps();
  const { data: rates,    isLoading: ratesLoading }   = useLpRates();
  const [search,     setSearch]     = useState('');
  const [hideUnset,  setHideUnset]  = useState(() => localStorage.getItem('lp-hideCorpsWithoutRate') === 'true');

  const loading = corpsLoading || ratesLoading;
  const rateMap = new Map((rates ?? []).map((r) => [r.corporationId, r.iskPerLp]));

  const filtered = (corps ?? []).filter((c) => {
    if (!c.corporationName.toLowerCase().includes(search.toLowerCase())) return false;
    if (hideUnset && rateMap.get(c.corporationId) == null) return false;
    return true;
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-1">LP Analysis</h1>
      <p className="text-gray-400 text-sm mb-4">
        Select a corporation to see ranked LP offers and weekly profit projections.
      </p>

      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <input
          type="text"
          placeholder="Search corporations..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); }}
          className="w-64 px-3 py-1.5 text-sm bg-gray-800 border border-gray-600 rounded text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500"
        />
        <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={hideUnset}
            onChange={(e) => { setHideUnset(e.target.checked); localStorage.setItem('lp-hideCorpsWithoutRate', String(e.target.checked)); }}
            className="w-3.5 h-3.5 accent-indigo-500"
          />
          Hide corps without LP rate
        </label>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="animate-pulse h-20 rounded bg-gray-800" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map((corp) => {
            const rate = rateMap.get(corp.corporationId);
            return (
              <Link
                key={corp.corporationId}
                to={`/lp/${corp.corporationId}`}
                className="block rounded bg-gray-800 border border-gray-700 hover:border-indigo-500 p-3 transition-colors"
              >
                <p className="text-sm font-medium text-white leading-tight">
                  {corp.corporationName}
                </p>
                <p className="text-xs mt-1 text-gray-400">
                  {rate != null
                    ? `${rate.toLocaleString()} ISK/LP`
                    : <span className="text-yellow-500">Set LP rate</span>
                  }
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Helper: column header with hover tooltip ────────────────────────────────

function ColHeader({ label, tip }: { label: string; tip: string }) {
  return (
    <span className="inline-flex items-center gap-1" title={tip}>
      {label}
      <span className="text-gray-500 text-[10px] cursor-help">ⓘ</span>
    </span>
  );
}

// ─── Offer table (/lp/:corporationId) ────────────────────────────────────────

function OfferTable({ corporationId }: { corporationId: number }) {
  const navigate = useNavigate();

  const { data: offers,   isLoading: offersLoading }   = useLpAnalysis(corporationId);
  const { data: rates }                                  = useLpRates();
  const { data: balances }                               = useLpBalances();
  const { data: plans }                                  = useOfferPlans();

  const upsertPlan  = useUpsertOfferPlan();
  const deletePlan  = useDeleteOfferPlan();
  const updateRate  = useUpdateLpRate();
  const updateBal   = useUpdateLpBalance();

  const [rateInput,    setRateInput]    = useState('');
  const [balInput,     setBalInput]     = useState('');
  const [editingRate,  setEditingRate]  = useState(false);
  const [editingBal,   setEditingBal]   = useState(false);
  const [hoveredOffer, setHoveredOffer] = useState<LpOffer | null>(null);

  const corp    = (rates    ?? []).find((r) => r.corporationId === corporationId);
  const balance = (balances ?? []).find((b) => b.corporationId === corporationId);
  const purchasePrice = corp?.iskPerLp ?? null;

  const planMap = new Map(
    (plans ?? []).map((p) => [`${p.corporationId}_${p.offerId}`, p.status])
  );

  function getPlanStatus(offerId: number) {
    return planMap.get(`${corporationId}_${offerId}`) ?? null;
  }

  function togglePlan(offer: LpOffer, status: 'planning' | 'doing') {
    const current = getPlanStatus(offer.offerId);
    if (current === status) {
      void deletePlan.mutateAsync({ corporationId, offerId: offer.offerId });
    } else {
      void upsertPlan.mutateAsync({ corporationId, offerId: offer.offerId, status });
    }
  }

  const columns: ColumnDef<LpOffer>[] = [
    {
      accessorKey: 'typeName',
      header: 'Item',
      cell: ({ row }) => (
        <span className="text-white font-medium">
          {row.original.typeName}
          {row.original.isBpc && (
            <span
              className="ml-1.5 px-1 py-0.5 text-xs rounded bg-indigo-900 text-indigo-300 font-normal"
              title={`Blueprint Copy — manufactures this item.\nBPC: ${row.original.bpcTypeName ?? ''}`}
            >
              BPC
            </span>
          )}
        </span>
      ),
    },
    {
      accessorKey: 'lpCost',
      header: 'LP Cost',
      cell: ({ getValue }) => fmtNum(getValue<number>()),
    },
    {
      accessorKey: 'iskCost',
      header: 'ISK Cost',
      cell: ({ getValue }) => fmtIsk(getValue<number>()),
    },
    {
      id: 'otherCosts',
      header: () => <ColHeader
        label="Other Costs"
        tip="Total ISK cost of items you must provide beyond the flat ISK fee. For regular offers this is the cost of required tags or exchange items. For BPC offers this also includes manufacturing materials. Shows — if any required item has no sell orders."
      />,
      accessorFn: (row) => {
        const matCost = row.isBpc ? row.bpcMaterialCost : 0;
        return row.otherCost !== null && matCost !== null
          ? row.otherCost + matCost
          : null;
      },
      cell: ({ getValue }) => {
        const v = getValue<number | null>();
        if (v == null) return <span className="text-gray-500">—</span>;
        return <span className="text-gray-300">{fmtIsk(v)}</span>;
      },
    },
    {
      accessorKey: 'bestSellPrice',
      header: 'Market Price',
      cell: ({ getValue }) => {
        const v = getValue<number | null>();
        if (v == null) return <span className="text-gray-500">—</span>;
        return <span className="text-gray-200">{fmtIsk(v)}</span>;
      },
    },
    {
      accessorKey: 'minSellPrice',
      header: () => <ColHeader
        label="Break-even"
        tip="The minimum sell price per unit needed to recover all costs (ISK fee, required items, manufacturing materials, logistics). Green = current market price beats this. Red = market price is too low to cover costs."
      />,
      cell: ({ row, getValue }) => {
        const v   = getValue<number | null>();
        const mkt = row.original.bestSellPrice;
        if (v == null) return <span className="text-gray-500">—</span>;
        const color = mkt !== null
          ? (mkt > v ? 'text-green-400' : 'text-red-400')
          : 'text-gray-300';
        return <span className={color}>{fmtIsk(v)}</span>;
      },
    },
    {
      id: 'iskPerLpEarned',
      header: () => <ColHeader
        label="ISK/LP (earned)"
        tip="ISK earned per LP point after selling the output and paying all non-LP costs. Green = earns more per LP than your purchase price (profitable). Red = earns less than you paid per LP (losing money on this offer)."
      />,
      accessorFn: (row) => row.iskPerLp,
      cell: ({ getValue }) => {
        const v = getValue<number | null>();
        if (v == null) return <span className="text-gray-500">—</span>;
        const color = purchasePrice !== null && v > purchasePrice
          ? 'text-green-400'
          : purchasePrice !== null
            ? 'text-red-400'
            : 'text-gray-100';
        return <span className={color}>{fmtIsk(v)}</span>;
      },
    },
    {
      id: 'trueProfit',
      header: () => <ColHeader
        label="True Profit"
        tip="ISK profit per single redemption after deducting your LP purchase cost. Requires your LP purchase price to be set. Positive = worth doing. Negative = you pay more for the LP than you earn back."
      />,
      accessorFn: (row) => calcWeekly(row, purchasePrice).trueProfit,
      cell: ({ getValue }) => {
        const v = getValue<number | null>();
        if (v == null) return <span className="text-gray-500">—</span>;
        const color = v >= 0 ? 'text-green-400' : 'text-red-400';
        return <span className={color}>{fmtIsk(v)}</span>;
      },
    },
    {
      id: 'profitPerCap',
      header: () => <ColHeader
        label="Profit/Cap"
        tip="Maximum weekly ISK profit if you hit your Sell Cap every week. = True Profit per redemption × weekly redemptions needed to reach cap. This is your ceiling — actual earnings depend on how quickly the item sells."
      />,
      accessorFn: (row) => calcWeekly(row, purchasePrice).weeklyNetProfit,
      cell: ({ getValue }) => {
        const v = getValue<number | null>();
        if (v == null) return <span className="text-gray-500">—</span>;
        const color = v >= 0 ? 'text-green-400' : 'text-red-400';
        return <span className={color}>{fmtIsk(v)}</span>;
      },
    },
    {
      accessorKey: 'maxWeeklySellUnits',
      header: () => <ColHeader
        label="Sell Cap/wk"
        tip="Your weekly sell target in units — 5% of the 7-day average market volume. Staying at this level keeps you below the threshold where your listings would start moving the market price against you."
      />,
      cell: ({ getValue }) => fmtNum(getValue<number | null>()),
    },
    {
      id: 'runsPerWeek',
      header: () => <ColHeader
        label="Runs/wk"
        tip="How many LP store redemptions you need per week to produce enough units to hit your Sell Cap. Under 1 means a single redemption already exceeds your weekly sell cap — don't over-produce."
      />,
      accessorFn: (row) =>
        row.maxWeeklySellUnits != null && row.quantity > 0
          ? row.maxWeeklySellUnits / row.quantity
          : null,
      cell: ({ getValue }) => {
        const v = getValue<number | null>();
        if (v == null) return <span className="text-gray-500">—</span>;
        if (v === 0)   return <span className="text-gray-500">0</span>;
        if (v < 1)     return <span className="text-gray-400">&lt;1</span>;
        return <span className="text-gray-300">{fmtNum(Math.round(v))}</span>;
      },
    },
    {
      accessorKey: 'quantity',
      header: () => <ColHeader
        label="Per Redem."
        tip="Number of units you receive per single redemption from the LP store. Higher = more output per LP spend, which reduces the number of runs needed to hit your weekly sell cap."
      />,
      cell: ({ getValue }) => fmtNum(getValue<number>()),
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row }) => {
        const status = getPlanStatus(row.original.offerId);
        return (
          <div className="flex gap-1">
            <button
              onClick={() => { togglePlan(row.original, 'planning'); }}
              title="Add to Planning"
              className={[
                'px-2 py-0.5 text-xs rounded transition-colors',
                status === 'planning'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-indigo-700 hover:text-white',
              ].join(' ')}
            >
              Plan
            </button>
            <button
              onClick={() => { togglePlan(row.original, 'doing'); }}
              title="Mark as Doing"
              className={[
                'px-2 py-0.5 text-xs rounded transition-colors',
                status === 'doing'
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-green-700 hover:text-white',
              ].join(' ')}
            >
              Doing
            </button>
          </div>
        );
      },
    },
  ];

  const exportColumns = [
    { header: 'Item',          accessor: (r: LpOffer) => r.typeName },
    { header: 'BPC',           accessor: (r: LpOffer) => r.isBpc ? r.bpcTypeName ?? 'Yes' : '' },
    { header: 'LP Cost',       accessor: (r: LpOffer) => r.lpCost },
    { header: 'ISK Cost',      accessor: (r: LpOffer) => r.iskCost },
    { header: 'Market Price',  accessor: (r: LpOffer) => r.bestSellPrice ?? '' },
    { header: 'Other Costs',   accessor: (r: LpOffer) => {
        const matCost = r.isBpc ? r.bpcMaterialCost : 0;
        return r.otherCost !== null && matCost !== null ? r.otherCost + matCost : '';
      },
    },
    { header: 'Break-even',    accessor: (r: LpOffer) => r.minSellPrice ?? '' },
    { header: 'ISK/LP earned', accessor: (r: LpOffer) => r.iskPerLp ?? '' },
    { header: 'True Profit',   accessor: (r: LpOffer) => calcWeekly(r, purchasePrice).trueProfit ?? '' },
    { header: 'Profit/Cap',    accessor: (r: LpOffer) => calcWeekly(r, purchasePrice).weeklyNetProfit ?? '' },
    { header: 'Sell Cap/wk',   accessor: (r: LpOffer) => r.maxWeeklySellUnits ?? '' },
  ];

  function saveRate() {
    const v = parseFloat(rateInput);
    if (!isNaN(v) && v >= 0) {
      void updateRate.mutateAsync({ corporationId, iskPerLp: v });
    }
    setEditingRate(false);
  }

  function saveBal() {
    const v = balInput === '' ? null : parseFloat(balInput);
    void updateBal.mutateAsync({ corporationId, currentLp: isNaN(v as number) ? null : v });
    setEditingBal(false);
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <button
          onClick={() => { navigate('/lp'); }}
          className="text-gray-400 hover:text-white text-sm"
        >
          ← Back
        </button>
        <h1 className="text-xl font-bold text-white">
          {corp?.corporationName ?? `Corp ${corporationId}`}
        </h1>

        {/* ISK/LP purchase rate */}
        {editingRate ? (
          <div className="flex items-center gap-1">
            <input
              type="number"
              min="0"
              value={rateInput}
              onChange={(e) => { setRateInput(e.target.value); }}
              placeholder="ISK/LP paid"
              className="w-32 px-2 py-1 text-sm bg-gray-800 border border-indigo-500 rounded text-gray-100 focus:outline-none"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') saveRate(); }}
            />
            <button onClick={saveRate} className="text-xs px-2 py-1 bg-indigo-600 rounded text-white">
              Save
            </button>
            <button onClick={() => { setEditingRate(false); }} className="text-xs px-2 py-1 bg-gray-700 rounded text-gray-300">
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setRateInput(String(purchasePrice ?? '')); setEditingRate(true); }}
            className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-300"
          >
            {purchasePrice != null ? `${purchasePrice.toLocaleString()} ISK/LP paid` : '+ Set LP purchase price'}
          </button>
        )}

        {/* LP balance */}
        {editingBal ? (
          <div className="flex items-center gap-1">
            <input
              type="number"
              min="0"
              value={balInput}
              onChange={(e) => { setBalInput(e.target.value); }}
              placeholder="My LP balance"
              className="w-32 px-2 py-1 text-sm bg-gray-800 border border-indigo-500 rounded text-gray-100 focus:outline-none"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') saveBal(); }}
            />
            <button onClick={saveBal} className="text-xs px-2 py-1 bg-indigo-600 rounded text-white">
              Save
            </button>
            <button onClick={() => { setEditingBal(false); }} className="text-xs px-2 py-1 bg-gray-700 rounded text-gray-300">
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setBalInput(String(balance?.currentLp ?? '')); setEditingBal(true); }}
            className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-300"
          >
            {balance?.currentLp != null
              ? `My LP: ${balance.currentLp.toLocaleString()}`
              : '+ Set LP balance'}
          </button>
        )}
      </div>

      {purchasePrice === null && (
        <div className="mb-3 px-3 py-2 bg-yellow-900/40 border border-yellow-700 rounded text-yellow-300 text-xs">
          Set the ISK/LP purchase price above to see True Profit and weekly projections.
        </div>
      )}

      <DataTable
        columns={columns}
        data={offers ?? []}
        isLoading={offersLoading}
        searchable
        onRowHover={setHoveredOffer}
      />

      {/* 30-day chart — only for offers that are being planned or actively done */}
      {hoveredOffer && getPlanStatus(hoveredOffer.offerId) != null && (
        <div className="mt-4 bg-gray-800 rounded border border-gray-700 p-4">
          <p className="text-xs text-gray-400 mb-2">
            30-Day Cost Breakdown — {hoveredOffer.typeName}
          </p>
          <CostBreakdownChart
            corporationId={corporationId}
            offerId={hoveredOffer.offerId}
            typeName={hoveredOffer.typeName}
            isBpc={hoveredOffer.isBpc}
          />
        </div>
      )}

      <ExportToolbar
        data={offers ?? []}
        filename={`lp-${corp?.corporationName ?? corporationId}`}
        columns={exportColumns}
      />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function LPAnalysis() {
  const { corporationId } = useParams<{ corporationId?: string }>();
  const corpId = corporationId ? parseInt(corporationId, 10) : null;

  if (corpId !== null && !isNaN(corpId)) {
    return <OfferTable corporationId={corpId} />;
  }
  return <CorpPicker />;
}
