// CostBreakdownChart.tsx
// 30-day stacked cost breakdown vs. market rate for a single LP offer.
//
// Stack (bottom → top): LP Cost | ISK Fee | Required Items Cost | Mfg Cost (BPC only)
// Line overlay: Market Rate (what you earn per redemption at historical avg price)
//
// When the Market Rate line is above the top of the stacked bars, the offer was
// profitable on that day. Red area between the stacks and the line = loss.

import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  type TooltipProps,
} from 'recharts';
import { useOfferCostHistory } from '../../api/lp';

interface CostBreakdownChartProps {
  corporationId: number;
  offerId:       number;
  typeName:      string;   // used in loading/empty state text
  isBpc:         boolean;  // whether to render the Mfg Cost (orange) layer
  compact?:      boolean;  // true = 220px height (for cards); false = 340px (hover panel)
}

const fmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const fmtFull = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

// Custom tooltip showing ISK-formatted values for all visible series
function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="bg-gray-900 border border-gray-600 rounded p-2 text-xs space-y-1 shadow-lg">
      <p className="text-gray-300 font-medium mb-1">{label}</p>
      {[...payload].reverse().map((entry) => (
        <div key={entry.dataKey as string} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
          <span className="text-gray-400">{entry.name}:</span>
          <span className="text-gray-100 font-medium">
            {entry.value != null ? `${fmtFull.format(entry.value as number)} ISK` : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function CostBreakdownChart({
  corporationId,
  offerId,
  typeName,
  isBpc,
  compact = false,
}: CostBreakdownChartProps) {
  const { data, isLoading } = useOfferCostHistory(corporationId, offerId);

  const height = compact ? 220 : 340;

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center text-gray-500 text-xs"
        style={{ height }}
      >
        Loading history for {typeName}…
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-gray-500 text-xs"
        style={{ height }}
      >
        No 30-day market history available for this offer.
      </div>
    );
  }

  // Shorten date label to "MM/DD" for readability on the X-axis
  const chartData = data.map((d) => ({
    ...d,
    dateLabel: d.date.slice(5).replace('-', '/'),  // "2026-02-01" → "02/01"
  }));

  // Determine which optional series are actually non-zero to avoid empty legend entries
  const hasRequiredItems = data.some((d) => (d.requiredItemsCost ?? 0) > 0);
  const hasMfgCost       = isBpc && data.some((d) => (d.mfgCost ?? 0) > 0);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={chartData}
        margin={{ top: 4, right: 8, left: 0, bottom: compact ? 16 : 32 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis
          dataKey="dateLabel"
          tick={{ fontSize: 10, fill: '#9ca3af' }}
          angle={compact ? -30 : -35}
          textAnchor="end"
          interval={compact ? 4 : 2}
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#9ca3af' }}
          tickFormatter={(v: number) => fmt.format(v)}
          width={54}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: 11, color: '#9ca3af', paddingTop: 4 }}
          iconSize={8}
        />

        {/* Stacked cost areas */}
        <Area
          type="monotone"
          dataKey="lpCostIsk"
          name="LP Cost"
          stackId="costs"
          fill="#4f46e5"
          stroke="#4f46e5"
          fillOpacity={0.7}
          strokeWidth={0}
          connectNulls={false}
        />
        <Area
          type="monotone"
          dataKey="iskFee"
          name="ISK Fee"
          stackId="costs"
          fill="#0284c7"
          stroke="#0284c7"
          fillOpacity={0.7}
          strokeWidth={0}
          connectNulls={false}
        />
        {hasRequiredItems && (
          <Area
            type="monotone"
            dataKey="requiredItemsCost"
            name="Items Cost"
            stackId="costs"
            fill="#0d9488"
            stroke="#0d9488"
            fillOpacity={0.7}
            strokeWidth={0}
            connectNulls={false}
          />
        )}
        {hasMfgCost && (
          <Area
            type="monotone"
            dataKey="mfgCost"
            name="Mfg Cost"
            stackId="costs"
            fill="#f97316"
            stroke="#f97316"
            fillOpacity={0.7}
            strokeWidth={0}
            connectNulls={false}
          />
        )}

        {/* Market rate line — revenue side */}
        <Line
          type="monotone"
          dataKey="marketRate"
          name="Market Rate"
          stroke="#4ade80"
          strokeWidth={2}
          dot={false}
          connectNulls={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
