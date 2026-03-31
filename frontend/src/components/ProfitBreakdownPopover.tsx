// ProfitBreakdownPopover.tsx
// Shows how True Profit is calculated when hovering the True Profit cell.
//
// When an LP offer gives quantity > 1, the breakdown shows per-unit values
// first, then a multiplier line showing the total per redemption.
//
// Required Items uses the walked order book cost (proportional allocation)
// when depth data is available from the parent page's depthMap.

import { createPortal } from 'react-dom';
import { type LpOffer } from '../api/lp';
import { type MarketDepthResult } from '../api/marketDepth';
import { fmtIsk, fmtNum } from '../lib/lpCalc';
import { usePopoverTrigger } from '../hooks/usePopoverTrigger';

interface ProfitBreakdownPopoverProps {
  offer:    LpOffer;
  iskPaid:  number;
  depthMap: Map<number, MarketDepthResult>;
  children: React.ReactNode;
}

export default function ProfitBreakdownPopover({
  offer,
  iskPaid,
  depthMap,
  children,
}: ProfitBreakdownPopoverProps) {
  const {
    hovered, pos, opensUp, triggerRef,
    handleTriggerEnter, handleTriggerLeave,
    cancelClose, scheduleClose,
  } = usePopoverTrigger('right');

  const qty = offer.quantity;
  const multiUnit = qty > 1;

  // Compute per-redemption totals first, then divide by qty for per-unit
  const grossSell = offer.grossSell;                         // bestSellPrice × quantity
  const taxes = grossSell != null && offer.afterTaxSell != null
    ? grossSell - offer.afterTaxSell : null;
  const lpCost = offer.lpCost * iskPaid;
  const iskFee = offer.iskCost;

  // Walk the order book for required items (proportional to 1 redemption)
  let walkedItemsCost = 0;
  for (const item of offer.requiredItems) {
    const depth = depthMap.get(item.typeId);
    if (depth && depth.quantityRequested > 0) {
      walkedItemsCost += (item.quantity / depth.quantityRequested) * depth.totalCost;
    } else {
      walkedItemsCost += (item.unitPrice ?? 0) * item.quantity;
    }
  }

  const mfgCost = offer.bpcMaterialCost ?? 0;
  const logistics = offer.logisticsCost;

  // Per-unit = each per-redemption value ÷ quantity
  const unitGrossSell  = grossSell != null ? grossSell / qty : null;
  const unitTaxes      = taxes != null ? taxes / qty : null;
  const unitLpCost     = lpCost / qty;
  const unitItemsCost  = walkedItemsCost / qty;
  const unitIskFee     = iskFee / qty;
  const unitMfgCost    = mfgCost / qty;
  const unitLogistics  = logistics / qty;

  const unitProfit = (unitGrossSell ?? 0) - (unitTaxes ?? 0)
    - unitLpCost - unitItemsCost - unitIskFee - unitMfgCost - unitLogistics;

  const totalProfit = unitProfit * qty;

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
          className="fixed z-[9999] w-80 bg-gray-900 border border-gray-600 rounded-lg shadow-xl p-3 text-xs"
          style={{
            top:    opensUp ? undefined : pos.top,
            bottom: opensUp ? window.innerHeight - pos.top : undefined,
            right:  pos.right,
          }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <p className="text-gray-200 font-medium mb-2">
            Profit Breakdown — per {multiUnit ? 'unit' : 'redemption'}
          </p>

          <div className="space-y-1">
            {/* Market Sell */}
            <div className="flex justify-between text-gray-300">
              <span>Market Sell</span>
              <span className="ml-2 flex-shrink-0">{fmtIsk(unitGrossSell)}</span>
            </div>

            {/* Taxes */}
            <div className="flex justify-between text-red-400">
              <span>− Taxes (broker + sales)</span>
              <span className="ml-2 flex-shrink-0">{unitTaxes != null ? fmtIsk(unitTaxes) : '—'}</span>
            </div>

            {/* LP Purchase */}
            <div className="flex justify-between text-red-400">
              <span>− LP{multiUnit ? ` (${fmtNum(offer.lpCost)}/${qty})` : ` (${fmtNum(offer.lpCost)} × ${fmtIsk(iskPaid)})`}</span>
              <span className="ml-2 flex-shrink-0">{fmtIsk(unitLpCost)}</span>
            </div>

            {/* Required Items */}
            {unitItemsCost > 0 && (
              <div className="flex justify-between text-red-400">
                <span>− Required Items{multiUnit ? ` (÷${qty})` : ''}</span>
                <span className="ml-2 flex-shrink-0">{fmtIsk(unitItemsCost)}</span>
              </div>
            )}

            {/* ISK Fee */}
            {unitIskFee > 0 && (
              <div className="flex justify-between text-red-400">
                <span>− ISK Fee{multiUnit ? ` (÷${qty})` : ''}</span>
                <span className="ml-2 flex-shrink-0">{fmtIsk(unitIskFee)}</span>
              </div>
            )}

            {/* Mfg Materials (BPC only) */}
            {unitMfgCost > 0 && (
              <div className="flex justify-between text-red-400">
                <span>− Mfg Materials{multiUnit ? ` (÷${qty})` : ''}</span>
                <span className="ml-2 flex-shrink-0">{fmtIsk(unitMfgCost)}</span>
              </div>
            )}

            {/* Logistics */}
            {unitLogistics > 0 && (
              <div className="flex justify-between text-red-400">
                <span>− Logistics{multiUnit ? ` (÷${qty})` : ''}</span>
                <span className="ml-2 flex-shrink-0">{fmtIsk(unitLogistics)}</span>
              </div>
            )}
          </div>

          {/* Divider + per-unit profit */}
          <div className="border-t border-gray-700 my-2" />
          <div className="flex justify-between text-gray-200 font-medium">
            <span>= Profit / unit</span>
            <span className={unitProfit >= 0 ? 'text-green-400' : 'text-red-400'}>
              {fmtIsk(unitProfit)}
            </span>
          </div>

          {/* Multiplier line for multi-unit offers */}
          {multiUnit && (
            <div className="flex justify-between text-gray-200 font-medium mt-1">
              <span>× {fmtNum(qty)} (Redeem Amount)</span>
              <span className={totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}>
                {fmtIsk(totalProfit)}
              </span>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
