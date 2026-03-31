// MarketDepthPopover.tsx
// Shows order book walk when hovering over a required material item.
//
// Fetches lazily on hover (200ms delay to avoid accidental triggers).
// Displays each sell order you'd need to buy from to fill the weekly quantity,
// cheapest first, with totals and a warning if supply is insufficient.
//
// Uses a React Portal so the popover escapes any overflow-hidden/auto containers.
// The popover stays open while the mouse is over either the trigger or the popover
// itself (short close delay prevents flicker when moving between the two).

import { createPortal } from 'react-dom';
import { useMarketDepth } from '../api/marketDepth';
import { fmtIsk, fmtNum } from '../lib/lpCalc';
import { usePopoverTrigger } from '../hooks/usePopoverTrigger';

interface MarketDepthPopoverProps {
  typeId:   number;
  typeName: string;
  quantity: number;           // weekly quantity needed
  children: React.ReactNode;  // the item name text to wrap
}

export default function MarketDepthPopover({
  typeId,
  typeName,
  quantity,
  children,
}: MarketDepthPopoverProps) {
  const {
    hovered, pos, opensUp, triggerRef,
    handleTriggerEnter, handleTriggerLeave,
    cancelClose, scheduleClose,
  } = usePopoverTrigger('left');

  // Lazy fetch: only runs when hovered = true
  const { data, isLoading } = useMarketDepth(typeId, quantity, hovered);

  return (
    <div
      ref={triggerRef}
      className="inline-block"
      onMouseEnter={handleTriggerEnter}
      onMouseLeave={handleTriggerLeave}
    >
      {children}

      {hovered && pos && createPortal(
        <div
          className="fixed z-[9999] w-96 bg-gray-900 border border-gray-600 rounded-lg shadow-xl p-3 text-xs"
          style={{
            top:    opensUp ? undefined : pos.top,
            bottom: opensUp ? window.innerHeight - pos.top : undefined,
            left:   pos.left,
          }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          {/* Header */}
          <p className="text-gray-200 font-medium mb-2">
            {typeName} — Need {fmtNum(quantity)}/wk
          </p>

          {isLoading && (
            <p className="text-gray-500">Loading order book…</p>
          )}

          {data && data.steps.length === 0 && (
            <p className="text-red-400">No sell orders available on market.</p>
          )}

          {data && data.steps.length > 0 && (
            <>
              {/* Order rows */}
              <div className="space-y-0.5 mb-2 max-h-48 overflow-y-auto font-mono">
                {data.steps.map((step, i) => (
                  <div key={i} className="flex justify-between text-gray-300">
                    <span>
                      {fmtIsk(step.price)} × {fmtNum(step.qtyUsed)}
                    </span>
                    <span className="text-gray-400 ml-2 flex-shrink-0">
                      {fmtIsk(step.lineCost)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Divider */}
              <div className="border-t border-gray-700 my-2" />

              {/* Totals */}
              <div className="flex justify-between text-gray-200 font-medium">
                <span>Total:</span>
                <span>{fmtIsk(data.totalCost)} ISK</span>
              </div>
              <div className="flex justify-between text-gray-400 mt-0.5">
                <span>Avg price/unit:</span>
                <span>{fmtIsk(data.weightedAvgPrice)} ISK</span>
              </div>

              {/* Supply warning */}
              {!data.fullyFilled && (
                <div className="mt-2 px-2 py-1 bg-red-900/40 border border-red-700 rounded text-red-300 text-xs">
                  Insufficient supply! Only {fmtNum(data.quantityFilled)} of{' '}
                  {fmtNum(data.quantityRequested)} units available on market.
                </div>
              )}
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
