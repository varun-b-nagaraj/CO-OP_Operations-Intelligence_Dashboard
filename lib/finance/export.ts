import { FinanceGeneratedRow } from '@/lib/finance/types';

function escapeCsvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function buildFinanceReportCsv(rows: FinanceGeneratedRow[]): string {
  const headers = [
    'Business Sales Date',
    'Payout Date',
    'Collected',
    'Fee',
    'Payout',
    'Credit Activity Revenue (Taxed)',
    'Credit Sales Tax Applied',
    'Credit Activity Revenue (Non-Taxed)',
    'Debit Lightspeed Fee',
    'Debit Cash Account',
    'ACH Bank Date',
    'GCR/GNI'
  ];

  const lines = [headers.map((header) => escapeCsvCell(header)).join(',')];

  for (const row of rows) {
    lines.push(
      [
        row.business_sales_date,
        row.payout_date,
        row.collected_amount,
        row.fee_amount,
        row.payout_amount,
        row.taxed_sales_amount,
        row.sales_tax_amount,
        row.non_taxed_sales_amount,
        row.lightspeed_fee_debit,
        row.cash_account_debit,
        row.ach_bank_date,
        row.gcr_gni
      ]
        .map((value) => escapeCsvCell(value))
        .join(',')
    );
  }

  return lines.join('\n');
}
