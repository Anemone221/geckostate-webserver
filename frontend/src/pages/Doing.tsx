import { useMemo, useState, useCallback, useEffect } from 'react';
import { useQueries } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import DataTable from '../components/DataTable';
import ProfitBarChart from '../components/charts/ProfitBarChart';
import CostBreakdownChart from '../components/charts/CostBreakdownChart';
import MarketDepthPopover from '../components/MarketDepthPopover';
import CapitalBreakdownPopover from '../components/CapitalBreakdownPopover';
import ProfitBreakdownPopover from '../components/ProfitBreakdownPopover';
import ExportToolbar, { type SheetData } from '../components/ExportToolbar';
import {
  useOfferPlans, useUpsertOfferPlan, useDeleteOfferPlan, type OfferPlan,
} from '../api/offerPlans';
import { useLpRates, type LpOffer } from '../api/lp';
import { apiFetch } from '../api/client';
import { type MarketDepthResult } from '../api/marketDepth';
import { calcWeekly, type WeeklyProjection, fmtIsk, fmtPct, fmtNum } from '../lib/lpCalc';
import { STALE_TIME_DEFAULT, FEEDBACK_TIMEOUT_MS } from '../lib/constants';

// ─── Types ────────────────────────────────────────────────────────────────────

const EMPTY_PROJ: WeeklyProjection = {
  trueProfit: null, weeklyRedemptions: null, weeklyLpSpend: null,
  weeklyLpPurchaseCost: null, weeklyIskCost: null,
  weeklyCapitalNeeded: null, weeklyNetProfit: null, weeklyROIPct: null,
};

interface DoingRow extends OfferPlan {
  offer:   LpOffer | null;
  iskPaid: number | null;
  proj:    WeeklyProjection;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Doing() {
  const { data: plans, isLoading: plansLoading } = useOfferPlans('doing');
  const { data: rates }                           = useLpRates();
  const upsertPlan = useUpsertOfferPlan();
  const deletePlan = useDeleteOfferPlan();
  const [hoveredRow, setHoveredRow] = useState<DoingRow | null>(null);
  const [multiBuyCopied, setMultiBuyCopied] = useState(false);
  const [excludedOffers, setExcludedOffers] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('doing-excludedOffers');
      return stored ? new Set(JSON.parse(stored) as string[]) : new Set();
    } catch { return new Set(); }
  });

  useEffect(() => {
    localStorage.setItem('doing-excludedOffers', JSON.stringify([...excludedOffers]));
  }, [excludedOffers]);

  // Unique corp IDs present in the doing list
  const corpIds = useMemo(
    () => [...new Set((plans ?? []).map((p) => p.corporationId))],
    [plans],
  );

  // Parallel LP analysis queries — one per unique corp
  const analysisResults = useQueries({
    queries: corpIds.map((id) => ({
      queryKey: ['lp', 'analysis', id] as const,
      queryFn:  () => apiFetch<LpOffer[]>(`/api/lp/${id}`),
    })),
  });

  const rateMap = useMemo(
    () => new Map((rates ?? []).map((r) => [r.corporationId, r.iskPerLp])),
    [rates],
  );

  // Corps that are actively doing but have no LP rate set — show a warning
  const corpsWithoutRate = useMemo(() => {
    const seen = new Map<number, string>();
    (plans ?? []).forEach((p) => {
      if (!seen.has(p.corporationId) && !rateMap.get(p.corporationId)) {
        seen.set(p.corporationId, p.corporationName);
      }
    });
    return [...seen.values()];
  }, [plans, rateMap]);

  // Index analysis results by corporationId for fast lookup
  const offersByCorp = useMemo(() => {
    const map = new Map<number, LpOffer[]>();
    corpIds.forEach((id, i) => {
      const d = analysisResults[i]?.data;
      if (d) map.set(id, d);
    });
    return map;
  }, [corpIds, analysisResults]);

  // Merge plan records with live offer data and computed projections
  const rows: DoingRow[] = useMemo(() => {
    if (!plans) return [];
    return plans.map((plan) => {
      const offerList = offersByCorp.get(plan.corporationId) ?? [];
      const offer     = offerList.find((o) => o.offerId === plan.offerId) ?? null;
      const iskPaid   = rateMap.get(plan.corporationId) ?? null;
      const proj      = offer ? calcWeekly(offer, iskPaid) : EMPTY_PROJ;
      return { ...plan, offer, iskPaid, proj };
    });
  }, [plans, offersByCorp, rateMap]);

  // ─── Multi-buy selection ─────────────────────────────────────────────────
  // By default all offers are included. Users can uncheck rows to exclude
  // them from the Required Materials aggregation and Copy Multi-Buy.

  const offerKey = (r: DoingRow) => `${r.corporationId}-${r.offerId}`;

  const toggleOffer = useCallback((key: string) => {
    setExcludedOffers((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const allSelected = excludedOffers.size === 0;
  const noneSelected = rows.length > 0 && excludedOffers.size === rows.length;

  const toggleAll = useCallback(() => {
    if (allSelected) {
      // Deselect all
      setExcludedOffers(new Set(rows.map(offerKey)));
    } else {
      // Select all
      setExcludedOffers(new Set());
    }
  }, [allSelected, rows]);

  const selectedRows = useMemo(
    () => rows.filter((r) => !excludedOffers.has(offerKey(r))),
    [rows, excludedOffers],
  );

  // ─── Required materials ───────────────────────────────────────────────────

  interface MatRow {
    typeId:     number;
    typeName:   string;
    weeklyQty:  number;
    unitPrice:  number | null;
    weeklyCost: number | null;
  }

  const materials = useMemo(() => {
    const weeklyIskFee = selectedRows.reduce((sum, r) => {
      return sum + (r.offer?.iskCost ?? 0) * (r.proj.weeklyRedemptions ?? 0);
    }, 0);

    const matMap = new Map<number, MatRow>();
    selectedRows.forEach((r) => {
      const redem = r.proj.weeklyRedemptions ?? 0;
      if (redem === 0 || !r.offer) return;
      r.offer.requiredItems.forEach((item) => {
        const weeklyQty = item.quantity * redem;
        if (matMap.has(item.typeId)) {
          const existing = matMap.get(item.typeId)!;
          existing.weeklyQty += weeklyQty;
          existing.weeklyCost = existing.unitPrice != null
            ? existing.unitPrice * existing.weeklyQty
            : null;
        } else {
          matMap.set(item.typeId, {
            typeId:     item.typeId,
            typeName:   item.typeName,
            weeklyQty,
            unitPrice:  item.unitPrice,
            weeklyCost: item.unitPrice != null ? item.unitPrice * weeklyQty : null,
          });
        }
      });
    });

    return {
      weeklyIskFee,
      items: [...matMap.values()].sort((a, b) => a.typeName.localeCompare(b.typeName)),
    };
  }, [selectedRows]);

  // ─── Order book depth for each required item ─────────────────────────────

  const depthResults = useQueries({
    queries: materials.items.map((m) => ({
      queryKey: ['market-depth', m.typeId, m.weeklyQty] as const,
      queryFn:  () => apiFetch<MarketDepthResult>(
        `/api/market-depth/${m.typeId}?quantity=${m.weeklyQty}`,
      ),
      staleTime: STALE_TIME_DEFAULT,
      enabled:   m.weeklyQty > 0,
    })),
  });

  const depthMap = useMemo(() => {
    const map = new Map<number, MarketDepthResult>();
    materials.items.forEach((m, i) => {
      const d = depthResults[i]?.data;
      if (d) map.set(m.typeId, d);
    });
    return map;
  }, [materials.items, depthResults]);

  // Copy materials in EVE multi-buy format (tab-separated name + quantity)
  const copyMultiBuy = useCallback(() => {
    const text = materials.items
      .map((m) => `${m.typeName}\t${m.weeklyQty}`)
      .join('\n');
    void navigator.clipboard.writeText(text).then(() => {
      setMultiBuyCopied(true);
      setTimeout(() => setMultiBuyCopied(false), FEEDBACK_TIMEOUT_MS);
    });
  }, [materials.items]);

  const materialsSheet: SheetData = {
    name: 'Required Materials',
    rows: [
      ...(materials.weeklyIskFee > 0
        ? [{ Item: 'ISK Fee (flat)', 'Weekly Qty': '', 'Avg Price': '', 'Weekly Cost': materials.weeklyIskFee }]
        : []),
      ...materials.items.map((m) => {
        const depth = depthMap.get(m.typeId);
        return {
          Item:          m.typeName,
          'Weekly Qty':  m.weeklyQty,
          'Avg Price':   depth?.weightedAvgPrice ?? m.unitPrice ?? '',
          'Weekly Cost': depth?.totalCost ?? m.weeklyCost ?? '',
        };
      }),
    ],
  };

  // ─── Walked costs per row ────────────────────────────────────────────────

  const { walkedCapitalMap, walkedTrueProfitMap } = useMemo(() => {
    const capitalMap = new Map<string, number>();
    const profitMap  = new Map<string, number>();
    rows.forEach((r) => {
      const { offer, iskPaid, proj } = r;
      if (!offer || iskPaid == null || proj.weeklyRedemptions == null) return;
      if (offer.afterTaxSell == null) return;
      const wr = proj.weeklyRedemptions;

      const lpPurchaseCost  = iskPaid * offer.lpCost * wr;
      const weeklyIskFee    = offer.iskCost * wr;
      const weeklyLogistics = offer.logisticsCost * wr;
      const weeklyMfgCost   = offer.bpcMaterialCost != null ? offer.bpcMaterialCost * wr : 0;

      let walkedItemsCost = 0;
      for (const item of offer.requiredItems) {
        const perOfferQty = item.quantity * wr;
        const depth = depthMap.get(item.typeId);
        if (depth && depth.quantityRequested > 0) {
          walkedItemsCost += (perOfferQty / depth.quantityRequested) * depth.totalCost;
        } else {
          walkedItemsCost += (item.unitPrice ?? 0) * perOfferQty;
        }
      }

      const key = `${r.corporationId}-${r.offerId}`;
      capitalMap.set(key, lpPurchaseCost + weeklyIskFee + walkedItemsCost + weeklyMfgCost + weeklyLogistics);

      const walkedTotalCost = offer.iskCost + (walkedItemsCost / wr) + offer.logisticsCost + (offer.bpcMaterialCost ?? 0);
      const walkedProfit    = offer.afterTaxSell - walkedTotalCost;
      const trueProfit      = walkedProfit - offer.lpCost * iskPaid;
      profitMap.set(key, trueProfit);
    });
    return { walkedCapitalMap: capitalMap, walkedTrueProfitMap: profitMap };
  }, [rows, depthMap]);

  // ─── Chart data ───────────────────────────────────────────────────────────

  const chartData = selectedRows
    .filter((r) => r.offer != null && (walkedTrueProfitMap.has(`${r.corporationId}-${r.offerId}`) || r.proj.trueProfit != null))
    .map((r) => {
      const key = `${r.corporationId}-${r.offerId}`;
      const profit = walkedTrueProfitMap.get(key) ?? r.proj.trueProfit!;
      return { name: r.typeName, value: profit / (r.offer!.quantity || 1) };
    });

  // ─── Totals ───────────────────────────────────────────────────────────────

  const totals = useMemo(() => {
    const withData = selectedRows.filter((r) => r.proj.weeklyNetProfit != null);
    if (withData.length === 0) return null;
    const lpByCorp = new Map<string, number>();
    const reqItemsCostByCorp = new Map<string, number>();
    withData.forEach((r) => {
      if (r.proj.weeklyLpSpend != null) {
        lpByCorp.set(r.corporationName, (lpByCorp.get(r.corporationName) ?? 0) + r.proj.weeklyLpSpend);
      }
      if (r.offer && r.proj.weeklyRedemptions != null) {
        const wr = r.proj.weeklyRedemptions;
        let itemsCost = 0;
        for (const item of r.offer.requiredItems) {
          const perOfferQty = item.quantity * wr;
          const depth = depthMap.get(item.typeId);
          if (depth && depth.quantityRequested > 0) {
            itemsCost += (perOfferQty / depth.quantityRequested) * depth.totalCost;
          } else {
            itemsCost += (item.unitPrice ?? 0) * perOfferQty;
          }
        }
        const mfg = r.offer.bpcMaterialCost != null ? r.offer.bpcMaterialCost * wr : 0;
        const logistics = r.offer.logisticsCost * wr;
        const corpCost = itemsCost + mfg + logistics;
        reqItemsCostByCorp.set(r.corporationName, (reqItemsCostByCorp.get(r.corporationName) ?? 0) + corpCost);
      }
    });
    const totalCapital = withData.reduce((s, r) => {
      const key = `${r.corporationId}-${r.offerId}`;
      return s + (walkedCapitalMap.get(key) ?? r.proj.weeklyCapitalNeeded ?? 0);
    }, 0);
    const totalProfit  = withData.reduce((s, r) => {
      const key = `${r.corporationId}-${r.offerId}`;
      const walkedProfit = walkedTrueProfitMap.get(key);
      const wr = r.proj.weeklyRedemptions;
      const weeklyProfit = walkedProfit != null && wr != null ? walkedProfit * wr : r.proj.weeklyNetProfit ?? 0;
      return s + weeklyProfit;
    }, 0);
    const roi          = totalCapital > 0 ? (totalProfit / totalCapital) * 100 : null;
    return { lpByCorp, reqItemsCostByCorp, totalCapital, totalProfit, roi, partial: withData.length < selectedRows.length };
  }, [selectedRows, walkedCapitalMap, walkedTrueProfitMap, depthMap]);

  // ─── Columns ──────────────────────────────────────────────────────────────

  const columns: ColumnDef<DoingRow>[] = [
    {
      id: 'multiBuySelect',
      header: () => (
        <input
          type="checkbox"
          checked={allSelected}
          ref={(el) => { if (el) el.indeterminate = !allSelected && !noneSelected; }}
          onChange={toggleAll}
          title="Select/deselect all for Multi-Buy"
          className="accent-indigo-500"
        />
      ),
      enableSorting: false,
      cell: ({ row }) => {
        const key = offerKey(row.original);
        return (
          <input
            type="checkbox"
            checked={!excludedOffers.has(key)}
            onChange={() => toggleOffer(key)}
            className="accent-indigo-500"
          />
        );
      },
    },
    {
      id: 'profitable',
      header: 'Profitable?',
      accessorFn: (r) => {
        const key = `${r.corporationId}-${r.offerId}`;
        return walkedTrueProfitMap.get(key) ?? r.proj.trueProfit;
      },
      cell: ({ getValue }) => {
        const v = getValue<number | null>();
        if (v == null) return <span className="text-gray-500 text-xs">—</span>;
        return v > 0
          ? <span className="text-green-400 font-bold">✓</span>
          : <span className="text-red-400 font-bold">✗</span>;
      },
    },
    {
      accessorKey: 'corporationName',
      header: 'Corp',
      cell: ({ getValue }) => (
        <span className="text-gray-300 text-xs">{getValue<string>()}</span>
      ),
    },
    {
      accessorKey: 'typeName',
      header: 'Item',
      cell: ({ getValue }) => (
        <span className="text-white font-medium">{getValue<string>()}</span>
      ),
    },
    {
      id: 'trueProfit',
      header: 'True Profit',
      accessorFn: (r) => {
        const key = `${r.corporationId}-${r.offerId}`;
        return walkedTrueProfitMap.get(key) ?? r.proj.trueProfit;
      },
      cell: ({ row, getValue }) => {
        const v = getValue<number | null>();
        if (v == null) return <span className="text-gray-500">—</span>;
        const r = row.original;
        if (!r.offer || r.iskPaid == null) {
          return <span className={v >= 0 ? 'text-green-400' : 'text-red-400'}>{fmtIsk(v)}</span>;
        }
        return (
          <ProfitBreakdownPopover offer={r.offer} iskPaid={r.iskPaid} depthMap={depthMap}>
            <span className={`${v >= 0 ? 'text-green-400' : 'text-red-400'} border-b border-dotted border-gray-600 cursor-default`}>
              {fmtIsk(v)}
            </span>
          </ProfitBreakdownPopover>
        );
      },
    },
    {
      id: 'iskPerLpEarned',
      header: 'ISK/LP earned',
      accessorFn: (r) => r.offer?.iskPerLp ?? null,
      cell: ({ row, getValue }) => {
        const v    = getValue<number | null>();
        const paid = row.original.iskPaid;
        if (v == null) return <span className="text-gray-500">—</span>;
        const color = paid != null
          ? (v > paid ? 'text-green-400' : 'text-red-400')
          : 'text-gray-100';
        return <span className={color}>{fmtIsk(v)}</span>;
      },
    },
    {
      id: 'iskPaid',
      header: 'ISK/LP paid',
      accessorFn: (r) => r.iskPaid,
      cell: ({ getValue }) => {
        const v = getValue<number | null>();
        return v != null
          ? <span className="text-gray-300">{fmtIsk(v)}</span>
          : <span className="text-yellow-500 text-xs">Not set</span>;
      },
    },
    {
      id: 'weeklyRedemptions',
      header: 'Red./wk',
      accessorFn: (r) => r.proj.weeklyRedemptions,
      cell: ({ getValue }) => fmtNum(getValue<number | null>()),
    },
    {
      id: 'weeklyLpSpend',
      header: 'LP/wk',
      accessorFn: (r) => r.proj.weeklyLpSpend,
      cell: ({ getValue }) => fmtNum(getValue<number | null>()),
    },
    {
      id: 'weeklyCapital',
      header: 'Capital/wk',
      accessorFn: (r) => {
        const key = `${r.corporationId}-${r.offerId}`;
        return walkedCapitalMap.get(key) ?? r.proj.weeklyCapitalNeeded;
      },
      cell: ({ row, getValue }) => {
        const v = getValue<number | null>();
        const o = row.original.offer;
        if (v == null || !o) return <span className="text-gray-500">—</span>;
        return (
          <CapitalBreakdownPopover
            iskPaid={row.original.iskPaid}
            lpCost={o.lpCost}
            iskCost={o.iskCost}
            requiredItems={o.requiredItems}
            bpcMaterialCost={o.bpcMaterialCost}
            logisticsCost={o.logisticsCost}
            weeklyRedemptions={row.original.proj.weeklyRedemptions ?? 0}
          >
            <span className="cursor-help border-b border-dotted border-gray-500">
              {fmtIsk(v)}
            </span>
          </CapitalBreakdownPopover>
        );
      },
    },
    {
      id: 'weeklyNetProfit',
      header: 'Net Profit/wk',
      accessorFn: (r) => {
        const key = `${r.corporationId}-${r.offerId}`;
        const walkedProfit = walkedTrueProfitMap.get(key);
        if (walkedProfit != null && r.proj.weeklyRedemptions != null) {
          return walkedProfit * r.proj.weeklyRedemptions;
        }
        return r.proj.weeklyNetProfit;
      },
      cell: ({ getValue }) => {
        const v = getValue<number | null>();
        if (v == null) return <span className="text-gray-500">—</span>;
        return <span className={v >= 0 ? 'text-green-400' : 'text-red-400'}>{fmtIsk(v)}</span>;
      },
    },
    {
      id: 'weeklyROI',
      header: 'ROI%/wk',
      accessorFn: (r) => {
        const key = `${r.corporationId}-${r.offerId}`;
        const capital = walkedCapitalMap.get(key) ?? r.proj.weeklyCapitalNeeded;
        const walkedProfit = walkedTrueProfitMap.get(key);
        const wr = r.proj.weeklyRedemptions;
        const profit = walkedProfit != null && wr != null ? walkedProfit * wr : r.proj.weeklyNetProfit;
        if (capital == null || profit == null || capital <= 0) return null;
        return (profit / capital) * 100;
      },
      cell: ({ getValue }) => {
        const v = getValue<number | null>();
        if (v == null) return <span className="text-gray-500">—</span>;
        return <span className={v >= 0 ? 'text-green-400' : 'text-red-400'}>{fmtPct(v)}</span>;
      },
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex gap-1">
          <button
            onClick={() => {
              void upsertPlan.mutateAsync({
                corporationId: row.original.corporationId,
                offerId:       row.original.offerId,
                status:        'planning',
              });
            }}
            title="Move back to planning"
            className="px-2 py-0.5 text-xs rounded bg-gray-700 text-gray-300 hover:bg-indigo-700 hover:text-white transition-colors"
          >
            ← Planning
          </button>
          <button
            onClick={() => {
              void deletePlan.mutateAsync({
                corporationId: row.original.corporationId,
                offerId:       row.original.offerId,
              });
            }}
            title="Remove from tracking"
            className="px-2 py-0.5 text-xs rounded bg-gray-700 text-gray-300 hover:bg-red-800 hover:text-white transition-colors"
          >
            Remove
          </button>
        </div>
      ),
    },
  ];

  // ─── Export columns ───────────────────────────────────────────────────────

  const exportColumns = [
    { header: 'Corp',          accessor: (r: DoingRow) => r.corporationName },
    { header: 'Item',          accessor: (r: DoingRow) => r.typeName },
    { header: 'Profitable',    accessor: (r: DoingRow) => r.proj.trueProfit != null ? (r.proj.trueProfit > 0 ? 'Yes' : 'No') : '' },
    { header: 'True Profit',   accessor: (r: DoingRow) => r.proj.trueProfit          ?? '' },
    { header: 'ISK/LP earned', accessor: (r: DoingRow) => r.offer?.iskPerLp         ?? '' },
    { header: 'ISK/LP paid',   accessor: (r: DoingRow) => r.iskPaid                 ?? '' },
    { header: 'Red./wk',       accessor: (r: DoingRow) => r.proj.weeklyRedemptions  ?? '' },
    { header: 'LP/wk',         accessor: (r: DoingRow) => r.proj.weeklyLpSpend      ?? '' },
    { header: 'Capital/wk',    accessor: (r: DoingRow) => r.proj.weeklyCapitalNeeded ?? '' },
    { header: 'Net Profit/wk', accessor: (r: DoingRow) => r.proj.weeklyNetProfit    ?? '' },
    { header: 'ROI%/wk',       accessor: (r: DoingRow) => r.proj.weeklyROIPct       ?? '' },
  ];

  // ─── Empty state ──────────────────────────────────────────────────────────

  if (!plansLoading && rows.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Currently Doing</h1>
        <p className="text-gray-400 text-sm mb-6">
          Offers you're actively running.
        </p>
        <p className="text-gray-500 text-sm">
          No active offers yet. Move offers here from the{' '}
          <strong className="text-gray-300">Planning</strong> page.
        </p>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-1">Currently Doing</h1>
      <p className="text-gray-400 text-sm mb-4">
        Offers you're actively running. Projections assume your configured market volume %.
      </p>

      {/* Warning banner for corps missing LP purchase rate */}
      {corpsWithoutRate.length > 0 && (
        <div className="mb-4 px-3 py-2 bg-yellow-900/40 border border-yellow-700 rounded text-yellow-300 text-xs">
          LP purchase price not set for: <strong>{corpsWithoutRate.join(', ')}</strong>.
          Set it on the LP Analysis page or in Settings to see true profit calculations.
        </div>
      )}

      {chartData.length > 0 && (
        <div className="mb-6 bg-gray-800 rounded p-4">
          <p className="text-xs text-gray-400 mb-2">Top 10 — Profit per Unit</p>
          <ProfitBarChart data={chartData} label="Profit / Unit (ISK)" positive={false} />
        </div>
      )}

      <DataTable
        columns={columns}
        data={rows}
        isLoading={plansLoading}
        searchable
        onRowHover={setHoveredRow}
      />

      {/* 30-day cost breakdown chart for the currently hovered row */}
      {hoveredRow?.offer && (
        <div className="mt-4 bg-gray-800 rounded border border-gray-700 p-4">
          <p className="text-xs text-gray-400 mb-2">
            30-Day Cost Breakdown — {hoveredRow.typeName}
          </p>
          <CostBreakdownChart
            corporationId={hoveredRow.corporationId}
            offerId={hoveredRow.offerId}
            typeName={hoveredRow.typeName}
            isBpc={hoveredRow.offer.isBpc}
          />
        </div>
      )}

      {totals && (
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3 bg-gray-800 border border-t-0 border-gray-700 rounded-b text-sm">
          <span className="text-gray-500 text-xs uppercase tracking-wide font-semibold">
            Totals{totals.partial ? ' *' : ''}
            {!allSelected && (
              <span className="text-indigo-400 normal-case font-normal ml-1">
                ({selectedRows.length}/{rows.length} selected)
              </span>
            )}
          </span>
          {[...totals.lpByCorp.entries()].map(([corp, lp]) => {
            const reqCost = totals.reqItemsCostByCorp.get(corp) ?? 0;
            return (
              <div key={corp} className="group relative cursor-default">
                <p className="text-gray-500 text-xs border-b border-dotted border-gray-600">{corp} LP/wk</p>
                <p className="text-gray-200 font-medium">{fmtNum(lp)}</p>
                <div className="hidden group-hover:block absolute bottom-full mb-1 left-0 z-[9999] w-56 bg-gray-900 border border-gray-600 rounded-lg shadow-xl p-2 text-xs">
                  <div className="flex justify-between text-gray-300">
                    <span>Required Items/wk:</span>
                    <span>{fmtIsk(reqCost)}</span>
                  </div>
                </div>
              </div>
            );
          })}
          <div className="w-px self-stretch bg-gray-700" />
          <div>
            <p className="text-gray-500 text-xs">Capital/wk</p>
            <p className="text-gray-200 font-medium">{fmtIsk(totals.totalCapital)}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs">Net Profit/wk</p>
            <p className={totals.totalProfit >= 0 ? 'text-green-400 font-medium' : 'text-red-400 font-medium'}>
              {fmtIsk(totals.totalProfit)}
            </p>
          </div>
          {totals.roi != null && (
            <div>
              <p className="text-gray-500 text-xs">Combined ROI</p>
              <p className={totals.roi >= 0 ? 'text-green-400 font-medium' : 'text-red-400 font-medium'}>
                {fmtPct(totals.roi)}
              </p>
            </div>
          )}
          {totals.partial && (
            <span className="text-gray-600 text-xs">
              * Rows with missing market data excluded from totals.
            </span>
          )}
        </div>
      )}

      {/* Required Materials section */}
      {(materials.weeklyIskFee > 0 || materials.items.length > 0) && (
        <div className="mt-6 print:break-before-page">
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">
              Required Materials — Weekly LP Store Redemptions
              {!allSelected && (
                <span className="ml-2 text-xs text-indigo-400 normal-case font-normal">
                  ({selectedRows.length} of {rows.length} offers selected)
                </span>
              )}
            </h2>
            {materials.items.length > 0 && (
              <button
                onClick={copyMultiBuy}
                className="px-2 py-0.5 text-xs rounded bg-gray-700 text-gray-300 hover:bg-indigo-700 hover:text-white transition-colors"
              >
                {multiBuyCopied ? 'Copied!' : 'Copy Multi-Buy'}
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Items you must hand in at the LP store each week. Does not include manufacturing materials for BPC offers.
          </p>
          <div className="bg-gray-800 rounded border border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400 text-xs uppercase">
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-right">Weekly Qty</th>
                  <th className="px-3 py-2 text-right" title="Weighted average price across all sell orders needed to fill weekly quantity">Avg Price</th>
                  <th className="px-3 py-2 text-right" title="True cost walking the sell order book (not just best price × qty)">Weekly Cost</th>
                </tr>
              </thead>
              <tbody>
                {materials.weeklyIskFee > 0 && (
                  <tr className="border-b border-gray-700/50">
                    <td className="px-3 py-1.5 text-gray-200">ISK Fee (flat)</td>
                    <td className="px-3 py-1.5 text-right text-gray-500">—</td>
                    <td className="px-3 py-1.5 text-right text-gray-500">—</td>
                    <td className="px-3 py-1.5 text-right text-gray-200">{fmtIsk(materials.weeklyIskFee)}</td>
                  </tr>
                )}
                {materials.items.map((mat) => {
                  const depth = depthMap.get(mat.typeId);
                  const avgPrice   = depth && depth.quantityFilled > 0 ? depth.weightedAvgPrice : mat.unitPrice;
                  const weeklyCost = depth ? depth.totalCost : mat.weeklyCost;
                  const insufficient = depth && !depth.fullyFilled;

                  return (
                    <tr key={mat.typeId} className="border-b border-gray-700/50 last:border-0">
                      <td className="px-3 py-1.5 text-gray-200">
                        <MarketDepthPopover
                          typeId={mat.typeId}
                          typeName={mat.typeName}
                          quantity={mat.weeklyQty}
                        >
                          <span className="cursor-help border-b border-dotted border-gray-500">
                            {mat.typeName}
                          </span>
                        </MarketDepthPopover>
                      </td>
                      <td className="px-3 py-1.5 text-right text-gray-300">{fmtNum(mat.weeklyQty)}</td>
                      <td className="px-3 py-1.5 text-right text-gray-300">
                        {avgPrice != null ? fmtIsk(avgPrice) : <span className="text-gray-500">—</span>}
                      </td>
                      <td className={`px-3 py-1.5 text-right ${insufficient ? 'text-yellow-400' : 'text-gray-300'}`}>
                        {weeklyCost != null ? fmtIsk(weeklyCost) : <span className="text-gray-500">—</span>}
                        {insufficient && (
                          <span className="ml-1 text-xs" title={`Only ${fmtNum(depth.quantityFilled)} of ${fmtNum(depth.quantityRequested)} available`}>⚠</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ExportToolbar data={rows} filename="lp-doing" columns={exportColumns} secondSheet={materialsSheet} />
    </div>
  );
}
