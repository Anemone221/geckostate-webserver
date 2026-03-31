import { useState, useRef, useEffect } from 'react';
import { useItemSearch, type ItemType } from '../api/items';
import { useManufacturing } from '../api/manufacturing';
import { fmtIsk } from '../lib/lpCalc';

// ─── Summary card ─────────────────────────────────────────────────────────────

function Card({ label, value, highlight }: { label: string; value: string; highlight?: 'green' | 'red' | null }) {
  const color = highlight === 'green'
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

// ─── Search input with dropdown ───────────────────────────────────────────────

interface SearchBoxProps {
  onSelect: (item: ItemType) => void;
}

function SearchBox({ onSelect }: SearchBoxProps) {
  const [query, setQuery]             = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const { data: results, isLoading: searching } = useItemSearch(query);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => { document.removeEventListener('mousedown', handleClick); };
  }, []);

  function handleSelect(item: ItemType) {
    onSelect(item);
    setQuery(item.typeName);
    setShowDropdown(false);
  }

  return (
    <div ref={wrapperRef} className="relative w-80">
      <input
        type="text"
        placeholder="Search items (e.g. Antimatter Charge S)..."
        value={query}
        onChange={(e) => { setQuery(e.target.value); setShowDropdown(true); }}
        onFocus={() => { if (results?.length) setShowDropdown(true); }}
        className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-600 rounded text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500"
      />

      {showDropdown && query.trim().length >= 2 && (
        <div className="absolute z-10 mt-1 w-full bg-gray-800 border border-gray-600 rounded shadow-lg max-h-60 overflow-y-auto">
          {searching && (
            <p className="px-3 py-2 text-xs text-gray-400">Searching...</p>
          )}
          {!searching && (!results || results.length === 0) && (
            <p className="px-3 py-2 text-xs text-gray-400">No items found.</p>
          )}
          {(results ?? []).map((item) => (
            <button
              key={item.typeId}
              onMouseDown={() => { handleSelect(item); }}
              className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-700 transition-colors"
            >
              {item.typeName}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Manufacturing() {
  const [selectedType, setSelectedType] = useState<{ typeId: number; typeName: string } | null>(null);

  const {
    data:      mfgData,
    isLoading: mfgLoading,
    error:     mfgError,
  } = useManufacturing(selectedType?.typeId ?? null);

  const profitHighlight = mfgData?.netProfit != null
    ? (mfgData.netProfit >= 0 ? 'green' : 'red') as 'green' | 'red'
    : null;

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-1">Manufacturing</h1>
      <p className="text-gray-400 text-sm mb-6">
        Search for an item to see its blueprint cost breakdown and profit.
      </p>

      <SearchBox onSelect={(item) => { setSelectedType({ typeId: item.typeId, typeName: item.typeName }); }} />

      {/* Loading */}
      {mfgLoading && (
        <div className="mt-8 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="animate-pulse h-8 rounded bg-gray-800" />
          ))}
        </div>
      )}

      {/* No blueprint found */}
      {mfgError && selectedType && (
        <div className="mt-6 px-3 py-2 bg-red-900/40 border border-red-700 rounded text-red-300 text-sm">
          No blueprint found for <strong>{selectedType.typeName}</strong>. This item may not be manufacturable.
        </div>
      )}

      {/* Missing market data warning */}
      {mfgData && (mfgData.outputSellPrice == null || mfgData.totalMaterialCost == null) && (
        <div className="mt-4 px-3 py-2 bg-yellow-900/40 border border-yellow-700 rounded text-yellow-300 text-xs">
          Some market data is missing (no sell orders found). Profit figures may be incomplete.
        </div>
      )}

      {/* Results */}
      {mfgData && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold text-white mb-4">
            {mfgData.outputTypeName}
            <span className="text-gray-400 text-sm font-normal ml-2">
              × {mfgData.outputQuantity} per run · {Math.round(mfgData.buildTimeSeconds / 60)} min build
            </span>
          </h2>

          {/* Material breakdown table */}
          <div className="mb-6 bg-gray-800 rounded border border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 bg-gray-750">
                  <th className="text-left px-4 py-2 text-gray-400 font-medium">Material</th>
                  <th className="text-right px-4 py-2 text-gray-400 font-medium">Qty</th>
                  <th className="text-right px-4 py-2 text-gray-400 font-medium">Unit Price</th>
                  <th className="text-right px-4 py-2 text-gray-400 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {mfgData.materials.map((mat, i) => (
                  <tr
                    key={mat.typeId}
                    className={i % 2 === 0 ? 'bg-gray-800' : 'bg-gray-800/50'}
                  >
                    <td className="px-4 py-2 text-gray-200">{mat.typeName}</td>
                    <td className="px-4 py-2 text-right text-gray-300">
                      {mat.quantity.toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-300">
                      {mat.unitPrice != null ? fmtIsk(mat.unitPrice) : <span className="text-gray-500">—</span>}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-200">
                      {mat.totalCost != null ? fmtIsk(mat.totalCost) : <span className="text-gray-500">—</span>}
                    </td>
                  </tr>
                ))}

                {/* Subtotals */}
                <tr className="border-t border-gray-600 bg-gray-700/40">
                  <td colSpan={3} className="px-4 py-2 text-gray-400 text-xs">Materials subtotal</td>
                  <td className="px-4 py-2 text-right text-gray-200 font-medium">
                    {fmtIsk(mfgData.totalMaterialCost)}
                  </td>
                </tr>
                {mfgData.logisticsCost > 0 && (
                  <tr className="bg-gray-700/20">
                    <td colSpan={3} className="px-4 py-2 text-gray-400 text-xs">Logistics</td>
                    <td className="px-4 py-2 text-right text-gray-200">
                      {fmtIsk(mfgData.logisticsCost)}
                    </td>
                  </tr>
                )}
                <tr className="border-t border-gray-600 bg-gray-700/60">
                  <td colSpan={3} className="px-4 py-2 text-gray-300 font-medium text-xs">Total Cost</td>
                  <td className="px-4 py-2 text-right text-white font-bold">
                    {fmtIsk(mfgData.totalCost)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Card label="Material Cost"  value={fmtIsk(mfgData.totalMaterialCost)} />
            <Card label="Total Cost"     value={fmtIsk(mfgData.totalCost)} />
            <Card label="Gross Revenue"  value={fmtIsk(mfgData.grossRevenue)} />
            <Card label="Net Revenue"    value={fmtIsk(mfgData.netRevenue)} />
            <Card
              label="Net Profit"
              value={fmtIsk(mfgData.netProfit)}
              highlight={profitHighlight}
            />
            <Card
              label="Margin %"
              value={mfgData.profitMarginPct != null
                ? mfgData.profitMarginPct.toLocaleString('en-US', { maximumFractionDigits: 1 }) + '%'
                : '—'}
              highlight={profitHighlight}
            />
          </div>

          {/* Tax detail */}
          <p className="mt-3 text-xs text-gray-500">
            Broker fee: {fmtIsk(mfgData.brokerFee)} · Sales tax: {fmtIsk(mfgData.salesTax)}
          </p>
        </div>
      )}
    </div>
  );
}
