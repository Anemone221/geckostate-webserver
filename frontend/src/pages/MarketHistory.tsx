// MarketHistory.tsx
// Shows a 30-day cost breakdown chart for every LP offer currently being planned or done.
// Two sections: Planning (top) and Currently Doing (bottom).
// Each offer gets its own compact chart card — corp name + item name as the header.

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useOfferPlans, type OfferPlan } from '../api/offerPlans';
import { type LpOffer } from '../api/lp';
import { apiFetch } from '../api/client';
import CostBreakdownChart from '../components/charts/CostBreakdownChart';

// Each card needs isBpc — fetch LP analysis per unique corp (same pattern as Plans/Doing)
interface EnrichedPlan extends OfferPlan {
  offer: LpOffer | null;
}

function useEnrichedPlans(status: 'planning' | 'doing') {
  const { data: plans, isLoading: plansLoading } = useOfferPlans(status);

  const corpIds = useMemo(
    () => [...new Set((plans ?? []).map((p) => p.corporationId))],
    [plans],
  );

  const analysisResults = useQueries({
    queries: corpIds.map((id) => ({
      queryKey: ['lp', 'analysis', id] as const,
      queryFn:  () => apiFetch<LpOffer[]>(`/api/lp/${id}`),
    })),
  });

  const offersByCorp = useMemo(() => {
    const map = new Map<number, LpOffer[]>();
    corpIds.forEach((id, i) => {
      const d = analysisResults[i]?.data;
      if (d) map.set(id, d);
    });
    return map;
  }, [corpIds, analysisResults]);

  const enriched: EnrichedPlan[] = useMemo(() => {
    if (!plans) return [];
    return plans.map((plan) => {
      const offerList = offersByCorp.get(plan.corporationId) ?? [];
      const offer     = offerList.find((o) => o.offerId === plan.offerId) ?? null;
      return { ...plan, offer };
    });
  }, [plans, offersByCorp]);

  return { enriched, isLoading: plansLoading };
}

// ─── Section component ────────────────────────────────────────────────────────

function HistorySection({
  title,
  status,
  emptyText,
}: {
  title:     string;
  status:    'planning' | 'doing';
  emptyText: string;
}) {
  const { enriched, isLoading } = useEnrichedPlans(status);

  return (
    <section>
      <h2 className="text-lg font-semibold text-white mb-3">{title}</h2>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="animate-pulse h-64 rounded bg-gray-800 border border-gray-700" />
          ))}
        </div>
      ) : enriched.length === 0 ? (
        <p className="text-gray-500 text-sm">{emptyText}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {enriched.map((plan) => (
            <div
              key={`${plan.corporationId}_${plan.offerId}`}
              className="bg-gray-800 rounded border border-gray-700 p-4"
            >
              <div className="flex items-baseline gap-2 mb-2">
                <p className="text-white font-medium text-sm">{plan.typeName}</p>
                <p className="text-gray-500 text-xs">{plan.corporationName}</p>
                {plan.offer?.isBpc && (
                  <span className="px-1 py-0.5 text-xs rounded bg-indigo-900 text-indigo-300">
                    BPC
                  </span>
                )}
              </div>
              <CostBreakdownChart
                corporationId={plan.corporationId}
                offerId={plan.offerId}
                typeName={plan.typeName}
                isBpc={plan.offer?.isBpc ?? false}
                compact
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MarketHistory() {
  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Market History</h1>
        <p className="text-gray-400 text-sm">
          30-day cost breakdown charts for all tracked LP offers.
          Stacked bars = costs per redemption. Green line = market sell rate.
          When the line is above the bars, the offer was profitable on that day.
        </p>
      </div>

      <HistorySection
        title="Planning"
        status="planning"
        emptyText="No planning offers yet. Go to LP Analysis and click Plan on an offer."
      />

      <HistorySection
        title="Currently Doing"
        status="doing"
        emptyText="No active offers yet. Move offers here from the Planning page."
      />
    </div>
  );
}
