// corp-trading-interpretation.service.ts
// Matches raw wallet transactions to journal entries to calculate
// broker fees, sales tax, and relisting costs.
//
// How matching works:
//   Each wallet transaction has a journalRefId that links to the
//   corresponding journal entry (refType "market_transaction").
//   Related fees appear as separate journal entries:
//     - "brokers_fee"      → broker fee for placing the order
//     - "transaction_tax"  → sales tax on a completed sale
//
//   We also look at broker fee journal entries where contextId matches
//   an existing order that was already active — these are relisting fees
//   (you pay a broker fee again when you modify an order's price).
//
// Item names are resolved from the items collection (SDE data).

import { WalletTransaction } from '../models/wallet-transaction.model';
import { WalletJournal } from '../models/wallet-journal.model';
import { CorpOrder } from '../models/corp-order.model';
import { Settings } from '../models/settings.model';
import mongoose from 'mongoose';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface InterpretedTransaction {
  transactionId:  number;
  date:           Date;
  typeId:         number;
  typeName:       string;
  quantity:       number;
  unitPrice:      number;
  totalIsk:       number;       // qty × unitPrice
  isBuy:          boolean;
  clientId:       number;
  // Matched from journal entries:
  brokerFee:      number | null;
  salesTax:       number | null;
  netProfit:      number | null;  // totalIsk - brokerFee - salesTax (for sells)
  matchedOrderId: number | null;  // linked open order if still active
}

export interface FeeSummary {
  totalBrokerFees:    number;
  totalSalesTax:      number;
  grossRevenue:       number;     // sum of sell transaction totals
  grossSpend:         number;     // sum of buy transaction totals
  lpPurchases:        number;     // corporation account withdrawals (ISK sent to buy LP)
  netRevenue:         number;     // grossRevenue - totalBrokerFees - totalSalesTax
  profit:             number;     // grossRevenue - grossSpend - lpPurchases - totalBrokerFees - totalSalesTax
  potentialRevenue:   number;     // value of open sell orders (price × volumeRemain)
  potentialSalesTax:  number;     // potentialRevenue × salesTaxPct
  potentialProfit:    number;     // profit + potentialRevenue - potentialSalesTax
  periodDays:         number;
}

// ─── Interpreted Transactions ────────────────────────────────────────────────

/**
 * Get transactions with matched fee data from journal entries.
 * Returns most recent first, limited to `limit` records.
 */
export async function getInterpretedTransactions(
  corporationId: number,
  division: number,
  limit = 100
): Promise<InterpretedTransaction[]> {
  // Fetch transactions (most recent first)
  const transactions = await WalletTransaction.find(
    { corporationId, division }
  )
    .sort({ date: -1 })
    .limit(limit)
    .lean();

  if (transactions.length === 0) return [];

  // Collect all journalRefIds to batch-fetch related journal entries
  const journalRefIds = transactions.map((tx) => tx.journalRefId);

  // Fetch the market_transaction journal entries that these transactions reference
  const journalEntries = await WalletJournal.find({
    corporationId,
    division,
    journalId: { $in: journalRefIds },
  }).lean();

  const journalMap = new Map(journalEntries.map((j) => [j.journalId, j]));

  // Find broker fee and tax entries in the same time range
  const oldestDate = transactions[transactions.length - 1]!.date;
  const feeEntries = await WalletJournal.find({
    corporationId,
    division,
    date: { $gte: oldestDate },
    refType: { $in: ['brokers_fee', 'transaction_tax'] },
  }).lean();

  // Build lookup: journalRefId → broker fee amount (negative = cost)
  // For transaction_tax entries, the contextId often matches a transaction
  const brokerFeeByContext = new Map<number, number>();
  const salesTaxByContext = new Map<number, number>();

  for (const fee of feeEntries) {
    if (fee.contextId == null) continue;
    if (fee.refType === 'brokers_fee') {
      brokerFeeByContext.set(fee.contextId, Math.abs(fee.amount));
    } else if (fee.refType === 'transaction_tax') {
      salesTaxByContext.set(fee.contextId, Math.abs(fee.amount));
    }
  }

  // Resolve item names from SDE items collection
  const typeIds = [...new Set(transactions.map((tx) => tx.typeId))];
  const itemsColl = mongoose.connection.collection('item_types');
  const items = await itemsColl
    .find({ typeId: { $in: typeIds } }, { projection: { typeId: 1, typeName: 1 } })
    .toArray();
  const nameMap = new Map(items.map((i) => [i['typeId'] as number, i['typeName'] as string]));

  // Get open order IDs for matching
  const openOrderIds = new Set(
    (await CorpOrder.find({ corporationId }, { orderId: 1 }).lean())
      .map((o) => o.orderId)
  );

  // Build interpreted results
  return transactions.map((tx) => {
    const journal = journalMap.get(tx.journalRefId);
    const totalIsk = tx.quantity * tx.unitPrice;

    // Match fees: check if any broker_fee or transaction_tax entry
    // has a contextId matching this transaction's journal entry or order
    const brokerFee = journal?.contextId
      ? brokerFeeByContext.get(journal.contextId) ?? null
      : null;
    const salesTax = journal?.contextId
      ? salesTaxByContext.get(journal.contextId) ?? null
      : null;

    // Net profit only makes sense for sell transactions
    let netProfit: number | null = null;
    if (!tx.isBuy) {
      const fees = (brokerFee ?? 0) + (salesTax ?? 0);
      netProfit = totalIsk - fees;
    }

    // Check if the order that generated this transaction is still open
    const matchedOrderId = journal?.contextId && openOrderIds.has(journal.contextId)
      ? journal.contextId
      : null;

    return {
      transactionId:  tx.transactionId,
      date:           tx.date,
      typeId:         tx.typeId,
      typeName:       nameMap.get(tx.typeId) ?? `Type ${tx.typeId}`,
      quantity:       tx.quantity,
      unitPrice:      tx.unitPrice,
      totalIsk,
      isBuy:          tx.isBuy,
      clientId:       tx.clientId,
      brokerFee,
      salesTax,
      netProfit,
      matchedOrderId,
    };
  });
}

// ─── Fee Summary ─────────────────────────────────────────────────────────────

/**
 * Aggregate broker fees, sales tax, and relisting costs for a given period.
 * Uses journal entries directly (most accurate source for fee amounts).
 */
export async function getFeeSummary(
  corporationId: number,
  division: number,
  days: number,
  characterId: number
): Promise<FeeSummary> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Fetch fee-related journal entries for the selected division
  const feeEntries = await WalletJournal.find({
    corporationId,
    division,
    date: { $gte: since },
    refType: { $in: ['brokers_fee', 'transaction_tax'] },
  }).lean();

  // Fetch corporation withdrawals for this division
  const withdrawalEntries = await WalletJournal.find({
    corporationId,
    division,
    date: { $gte: since },
    refType: { $in: ['corporation_account_withdrawal', 'lp_store'] },
  }).lean();

  const journalEntries = [...feeEntries, ...withdrawalEntries];

  let totalBrokerFees = 0;
  let totalSalesTax = 0;
  let lpPurchases = 0;

  for (const entry of journalEntries) {
    const amount = Math.abs(entry.amount);
    if (entry.refType === 'brokers_fee') {
      totalBrokerFees += amount;
    } else if (entry.refType === 'transaction_tax') {
      totalSalesTax += amount;
    } else if (entry.refType === 'corporation_account_withdrawal' || entry.refType === 'lp_store') {
      // Only count if user hasn't explicitly excluded it (null = included by default)
      if (entry.isLpPurchase !== false) {
        lpPurchases += amount;
      }
    }
  }

  // Fetch sell and buy transaction totals for the period
  const transactions = await WalletTransaction.find({
    corporationId,
    division,
    date: { $gte: since },
  }).lean();

  let grossRevenue = 0;
  let grossSpend = 0;

  for (const tx of transactions) {
    const total = tx.quantity * tx.unitPrice;
    if (tx.isBuy) {
      grossSpend += total;
    } else {
      grossRevenue += total;
    }
  }

  const netRevenue = grossRevenue - totalBrokerFees - totalSalesTax;
  const profit = grossRevenue - grossSpend - lpPurchases - totalBrokerFees - totalSalesTax;

  // Calculate potential profit from open sell orders in this division
  const openSellOrders = await CorpOrder.find({
    corporationId,
    isBuyOrder: false,
    walletDivision: division,
  }).lean();

  let potentialRevenue = 0;
  for (const order of openSellOrders) {
    potentialRevenue += order.price * order.volumeRemain;
  }

  // Use the requesting character's sales tax rate
  const settings = await Settings.findOne({ characterId }).lean();
  const salesTaxPct = settings?.salesTaxPct ?? 0.018;
  const potentialSalesTax = potentialRevenue * salesTaxPct;
  const potentialProfit = profit + potentialRevenue - potentialSalesTax;

  return {
    totalBrokerFees,
    totalSalesTax,
    grossRevenue,
    grossSpend,
    lpPurchases,
    netRevenue,
    profit,
    potentialRevenue,
    potentialSalesTax,
    potentialProfit,
    periodDays: days,
  };
}
