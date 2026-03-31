import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

interface DataPoint {
  name:  string;
  value: number;
}

interface ProfitBarChartProps {
  data:      DataPoint[];
  label?:    string;         // Y-axis label e.g. "Weekly Profit (ISK)"
  topN?:     number;         // Show only the top N entries (default 10)
  positive?: boolean;        // true = green bars, false = mixed red/green by value sign
}

const fmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export default function ProfitBarChart({
  data,
  label = 'Value',
  topN = 10,
  positive = true,
}: ProfitBarChartProps) {
  const chartData = [...data]
    .sort((a, b) => b.value - a.value)
    .slice(0, topN);

  return (
    <ResponsiveContainer width="100%" height={340}>
      <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 56 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11, fill: '#9ca3af' }}
          angle={-35}
          textAnchor="end"
          interval={0}
        />
        <YAxis
          tick={{ fontSize: 11, fill: '#9ca3af' }}
          tickFormatter={(v: number) => fmt.format(v)}
          label={{ value: label, angle: -90, position: 'insideLeft', fontSize: 11, fill: '#9ca3af', offset: 10 }}
        />
        <Tooltip
          contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 4 }}
          labelStyle={{ color: '#e5e7eb' }}
          formatter={(v: number) => [v.toLocaleString(), label]}
        />
        <Bar dataKey="value" radius={[3, 3, 0, 0]}>
          {chartData.map((entry, i) => (
            <Cell
              key={i}
              fill={positive || entry.value >= 0 ? '#4f46e5' : '#dc2626'}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
