import { FinanceGeneratedRow, FinanceReportTotals } from '@/lib/finance/types';

function round(value: number): number {
  return Number(value.toFixed(2));
}

export function computeFinanceTotals(rows: FinanceGeneratedRow[]): FinanceReportTotals {
  return rows.reduce<FinanceReportTotals>(
    (accumulator, row) => ({
      rowCount: accumulator.rowCount + 1,
      collected: round(accumulator.collected + row.collected_amount),
      fee: round(accumulator.fee + row.fee_amount),
      payout: round(accumulator.payout + row.payout_amount),
      taxedSales: round(accumulator.taxedSales + row.taxed_sales_amount),
      salesTax: round(accumulator.salesTax + row.sales_tax_amount),
      nonTaxedSales: round(accumulator.nonTaxedSales + row.non_taxed_sales_amount)
    }),
    {
      rowCount: 0,
      collected: 0,
      fee: 0,
      payout: 0,
      taxedSales: 0,
      salesTax: 0,
      nonTaxedSales: 0
    }
  );
}
