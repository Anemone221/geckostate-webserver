// CapitalBreakdownPopover.tsx
// Shows a per-offer capital breakdown when hovering the Capital/wk cell.
//
// Displays each cost component (LP purchase, ISK fee, required items with
// order book walks, manufacturing materials, logistics) and their weekly totals.
//
// Uses a React Portal so the popover escapes any overflow-hidden/auto containers.
// The popover stays open while the mouse is over either the trigger or the popover
// itself (short close delay prevents flicker when moving between the two).

import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQueries } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { type MarketDepthResult } from '../api/marketDepth';
import { type LpRequiredItem } from '../api/lp';
import { fmtIsk, fmtNum } from '../lib/lpCalc';
import { STALE_TIME_DEFAULT } from '../lib/constants';
import { usePopoverTrigger } from '../hooks/usePopoverTrigger';

interface CapitalBreakdownPopoverProps {
  /** ISK/LP purchase price (what the user pays per LP) */
  iskPaid:          number | null;
  lpCost:           number;
  iskCost:          number;
  requiredItems:    LpRequiredItem[];
  bpcMaterialCost:  number | null;
  logisticsCost:    number;
  weeklyRedemptions: number;
  children:         React.ReactNode;
}

export default function CapitalBreakdownPopover({
  iskPaid,
  lpCost,
  iskCost,
  requiredItems,
  bpcMaterialCost,
  logisticsCost,
  weeklyRedemptions,
  children,
}: CapitalBreakdownPopoverProps) {
  const {
    hovered, pos, opensUp, triggerRef,
    handleTriggerEnter, handleTriggerLeave,
    cancelClose, scheduleClose,
  } = usePopoverTrigger('right');

  // Build the per-redemption quantities we need to look up
  const itemRequests = useMemo(
    () => requiredItems.map((ri) => ({
      typeId:   ri.typeId,
      typeName: ri.typeName,
      quantity: ri.quantity * weeklyRedemptions,
    })),
    [requiredItems, weeklyRedemptions],
  );

  // Fetch order book depth for each required item (lazy — only on hover)
  const depthResults = useQueries({
    queries: itemRequests.map((item) => ({
      queryKey: ['market-depth', item.typeId, item.quantity] as const,
      queryFn:  () => apiFetch<MarketDepthResult>(
        `/api/market-depth/${item.typeId}?quantity=${item.quantity}`,
      ),
      staleTime: STALE_TIME_DEFAULT,
      enabled:   hovered && item.quantity > 0,
    })),
  });

  // Compute breakdown values
  const lpPurchaseCost = iskPaid != null ? lpCost * weeklyRedemptions * iskPaid : null;
  const weeklyIskFee   = iskCost * weeklyRedemptions;
  const weeklyLogistics = logisticsCost * weeklyRedemptions;
  const weeklyMfgCost   = bpcMaterialCost != null ? bpcMaterialCost * weeklyRedemptions : null;

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
            right:  pos.right,
          }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <p className="text-gray-200 font-medium mb-2">
            Capital Breakdown — {fmtNum(weeklyRedemptions)} redemptions/wk
          </p>

          <div className="space-y-1">
            {/* LP purchase cost */}
            {lpPurchaseCost != null && (
              <div className="flex justify-between text-gray-300">
                <span>LP Purchase ({fmtNum(lpCost * weeklyRedemptions)} LP × {fmtIsk(iskPaid!)})</span>
                <span className="ml-2 flex-shrink-0">{fmtIsk(lpPurchaseCost)}</span>
              </div>
            )}
            {lpPurchaseCost == null && (
              <div className="flex justify-between text-yellow-500">
                <span>LP Purchase</span>
                <span>Not set</span>
              </div>
            )}

            {/* ISK fee */}
            {weeklyIskFee > 0 && (
              <div className="flex justify-between text-gray-300">
                <span>ISK Fee ({fmtNum(weeklyRedemptions)} × {fmtIsk(iskCost)})</span>
                <span className="ml-2 flex-shrink-0">{fmtIsk(weeklyIskFee)}</span>
              </div>
            )}

            {/* Required items — each with order book walk */}
            {itemRequests.map((item, i) => {
              const depth = depthResults[i]?.data;
              const loading = depthResults[i]?.isLoading;
              const insufficient = depth && !depth.fullyFilled;

              return (
                <div key={item.typeId}>
                  <div className={`flex justify-between ${insufficient ? 'text-yellow-400' : 'text-gray-300'}`}>
                    <span>
                      {item.typeName} × {fmtNum(item.quantity)}
                      {insufficient && ' ⚠'}
                    </span>
                    <span className="ml-2 flex-shrink-0">
                      {loading ? '…' : depth ? fmtIsk(depth.totalCost) : '—'}
                    </span>
                  </div>
                  {/* Nested order book steps */}
                  {depth && depth.steps.length > 1 && (
                    <div className="ml-3 mt-0.5 space-y-0.5 text-gray-500 font-mono">
                      {depth.steps.map((step, j) => (
                        <div key={j} className="flex justify-between">
                          <span>{fmtIsk(step.price)} × {fmtNum(step.qtyUsed)}</span>
                          <span>{fmtIsk(step.lineCost)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Manufacturing materials (BPC only) */}
            {weeklyMfgCost != null && weeklyMfgCost > 0 && (
              <div className="flex justify-between text-gray-300">
                <span>Mfg Materials</span>
                <span className="ml-2 flex-shrink-0">{fmtIsk(weeklyMfgCost)}</span>
              </div>
            )}

            {/* Logistics */}
            {weeklyLogistics > 0 && (
              <div className="flex justify-between text-gray-300">
                <span>Logistics</span>
                <span className="ml-2 flex-shrink-0">{fmtIsk(weeklyLogistics)}</span>
              </div>
            )}
          </div>

          {/* Divider + subtotals + total */}
          <div className="border-t border-gray-700 my-2" />
          {(() => {
            if (lpPurchaseCost == null) return (
              <div className="flex justify-between text-gray-200 font-medium">
                <span>Total Capital/wk:</span>
                <span>—</span>
              </div>
            );
            const itemsCost = depthResults.reduce((sum, r) => {
              return sum + (r.data?.totalCost ?? 0);
            }, 0);
            const lpIskSubtotal = lpPurchaseCost + weeklyIskFee;
            const reqItemsSubtotal = itemsCost + (weeklyMfgCost ?? 0) + weeklyLogistics;
            const total = lpIskSubtotal + reqItemsSubtotal;
            return (
              <div className="space-y-1">
                <div className="flex justify-between text-gray-200 font-medium">
                  <span>Total Capital/wk:</span>
                  <span>{fmtIsk(total)}</span>
                </div>
                <div className="flex justify-between text-gray-400">
                  <span>LP + ISK Fees:</span>
                  <span>{fmtIsk(lpIskSubtotal)}</span>
                </div>
                <div className="flex justify-between text-gray-400">
                  <span>Required Items{weeklyMfgCost ? ' + Mfg' : ''}:</span>
                  <span>{fmtIsk(reqItemsSubtotal)}</span>
                </div>
              </div>
            );
          })()}
        </div>,
        document.body,
      )}
    </div>
  );
}
