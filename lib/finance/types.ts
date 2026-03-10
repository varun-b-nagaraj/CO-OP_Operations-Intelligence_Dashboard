export type FinanceReportStatus =
  | 'draft'
  | 'processed'
  | 'saved'
  | 'exported'
  | 'failed_validation';

export type FinanceIssueSeverity = 'info' | 'warning' | 'error';

export type FinanceColumnKey =
  | 'business_sales_date'
  | 'payout_date'
  | 'collected_amount'
  | 'fee_amount'
  | 'payout_amount'
  | 'taxed_sales_amount'
  | 'sales_tax_amount'
  | 'non_taxed_sales_amount'
  | 'ach_bank_date'
  | 'gcr_gni';

export type FinanceColumnMapping = Partial<Record<FinanceColumnKey, string>>;

export interface FinanceValidationIssue {
  row_index: number | null;
  severity: FinanceIssueSeverity;
  message: string;
  field_name: string | null;
  raw_value: string | null;
}

export interface FinanceGeneratedRow {
  row_index: number;
  business_sales_date: string;
  payout_date: string | null;
  collected_amount: number;
  fee_amount: number;
  payout_amount: number;
  taxed_sales_amount: number;
  sales_tax_amount: number;
  non_taxed_sales_amount: number;
  lightspeed_fee_debit: number;
  cash_account_debit: number;
  ach_bank_date: string | null;
  gcr_gni: string | null;
  raw_source_payload: Record<string, string>;
  generated_payload: Record<string, unknown>;
}

export interface FinanceReportTotals {
  rowCount: number;
  collected: number;
  fee: number;
  payout: number;
  taxedSales: number;
  salesTax: number;
  nonTaxedSales: number;
}

export interface FinanceUploadPreview {
  reportStatus: FinanceReportStatus;
  sourceFileName: string;
  availableHeaders: string[];
  inferredMapping: FinanceColumnMapping;
  appliedMapping: FinanceColumnMapping;
  rows: FinanceGeneratedRow[];
  issues: FinanceValidationIssue[];
  totals: FinanceReportTotals;
}

export interface FinanceTransformationConfig {
  activityRevenueCodeTaxed: string;
  activityRevenueCodeNonTaxed: string;
  salesTaxAccountCode: string;
  lightspeedFeeDebitCode: string;
  cashAccountDebitCode: string;
  defaultGcrGni: string;
}
