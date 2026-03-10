import { inferFinanceMapping } from '@/lib/finance/csv';
import { normalizeNullableText, parseCurrency, parseDateToIso } from '@/lib/finance/normalization';
import {
  FinanceColumnMapping,
  FinanceGeneratedRow,
  FinanceTransformationConfig,
  FinanceUploadPreview,
  FinanceValidationIssue
} from '@/lib/finance/types';
import { computeFinanceTotals } from '@/lib/finance/totals';

function roundAmount(value: number): number {
  return Number(value.toFixed(2));
}

function getMappedValue(
  row: Record<string, string>,
  mapping: FinanceColumnMapping,
  key: keyof FinanceColumnMapping
): string {
  const column = mapping[key];
  if (!column) return '';
  return row[column] ?? '';
}

function buildIssue(
  rowIndex: number,
  severity: FinanceValidationIssue['severity'],
  message: string,
  fieldName: string,
  rawValue: string
): FinanceValidationIssue {
  return {
    row_index: rowIndex,
    severity,
    message,
    field_name: fieldName,
    raw_value: rawValue || null
  };
}

export function transformFinanceRows(input: {
  sourceFileName: string;
  headers: string[];
  rows: Array<Record<string, string>>;
  requestedMapping?: FinanceColumnMapping;
  config: FinanceTransformationConfig;
}): FinanceUploadPreview {
  const inferredMapping = inferFinanceMapping(input.headers);
  const appliedMapping: FinanceColumnMapping = {
    ...inferredMapping,
    ...(input.requestedMapping ?? {})
  };

  const issues: FinanceValidationIssue[] = [];
  const generatedRows: FinanceGeneratedRow[] = [];

  const hasDateMapping = Boolean(appliedMapping.business_sales_date);
  const hasCollectedMapping = Boolean(appliedMapping.collected_amount);
  const hasFeeMapping = Boolean(appliedMapping.fee_amount);

  if (!hasDateMapping) {
    issues.push({
      row_index: null,
      severity: 'error',
      message: 'Unable to map Business Sales Date column.',
      field_name: 'business_sales_date',
      raw_value: null
    });
  }
  if (!hasCollectedMapping) {
    issues.push({
      row_index: null,
      severity: 'error',
      message: 'Unable to map Collected Amount column.',
      field_name: 'collected_amount',
      raw_value: null
    });
  }
  if (!hasFeeMapping) {
    issues.push({
      row_index: null,
      severity: 'error',
      message: 'Unable to map Fee Amount column.',
      field_name: 'fee_amount',
      raw_value: null
    });
  }

  input.rows.forEach((sourceRow, rowPosition) => {
    const rowIndex = rowPosition + 1;

    const businessSalesDateRaw = getMappedValue(sourceRow, appliedMapping, 'business_sales_date');
    const payoutDateRaw = getMappedValue(sourceRow, appliedMapping, 'payout_date');
    const achBankDateRaw = getMappedValue(sourceRow, appliedMapping, 'ach_bank_date');

    const collectedRaw = getMappedValue(sourceRow, appliedMapping, 'collected_amount');
    const feeRaw = getMappedValue(sourceRow, appliedMapping, 'fee_amount');
    const payoutRaw = getMappedValue(sourceRow, appliedMapping, 'payout_amount');
    const taxedRaw = getMappedValue(sourceRow, appliedMapping, 'taxed_sales_amount');
    const salesTaxRaw = getMappedValue(sourceRow, appliedMapping, 'sales_tax_amount');
    const nonTaxedRaw = getMappedValue(sourceRow, appliedMapping, 'non_taxed_sales_amount');

    const businessSalesDate = parseDateToIso(businessSalesDateRaw);
    const payoutDate = parseDateToIso(payoutDateRaw);
    const achBankDate = parseDateToIso(achBankDateRaw);

    if (!businessSalesDate) {
      issues.push(
        buildIssue(
          rowIndex,
          'error',
          'Invalid business sales date. Row was skipped.',
          'business_sales_date',
          businessSalesDateRaw
        )
      );
      return;
    }

    const collectedAmount = parseCurrency(collectedRaw);
    if (collectedAmount === null) {
      issues.push(
        buildIssue(rowIndex, 'error', 'Collected amount is missing or invalid.', 'collected_amount', collectedRaw)
      );
      return;
    }

    const feeAmount = parseCurrency(feeRaw);
    if (feeAmount === null) {
      issues.push(buildIssue(rowIndex, 'error', 'Fee amount is missing or invalid.', 'fee_amount', feeRaw));
      return;
    }

    const payoutFromSource = parseCurrency(payoutRaw);
    const payoutAmount = roundAmount(
      payoutFromSource === null ? collectedAmount - feeAmount : payoutFromSource
    );

    const taxedSalesAmount = roundAmount(parseCurrency(taxedRaw) ?? 0);
    const salesTaxAmount = roundAmount(parseCurrency(salesTaxRaw) ?? 0);

    let nonTaxedSalesAmount = roundAmount(parseCurrency(nonTaxedRaw) ?? 0);
    if (!nonTaxedSalesAmount && collectedAmount > 0) {
      nonTaxedSalesAmount = roundAmount(
        Math.max(collectedAmount - taxedSalesAmount - salesTaxAmount, 0)
      );
    }

    const gcrGni = normalizeNullableText(getMappedValue(sourceRow, appliedMapping, 'gcr_gni'));

    const balanceCheck = roundAmount(taxedSalesAmount + nonTaxedSalesAmount + salesTaxAmount);
    if (Math.abs(balanceCheck - collectedAmount) > 0.01) {
      issues.push(
        buildIssue(
          rowIndex,
          'warning',
          'Taxed/non-taxed/tax values do not reconcile exactly to collected total.',
          'collected_amount',
          collectedRaw
        )
      );
    }

    generatedRows.push({
      row_index: rowIndex,
      business_sales_date: businessSalesDate,
      payout_date: payoutDate,
      collected_amount: collectedAmount,
      fee_amount: feeAmount,
      payout_amount: payoutAmount,
      taxed_sales_amount: taxedSalesAmount,
      sales_tax_amount: salesTaxAmount,
      non_taxed_sales_amount: nonTaxedSalesAmount,
      lightspeed_fee_debit: feeAmount,
      cash_account_debit: payoutAmount,
      ach_bank_date: achBankDate,
      gcr_gni: gcrGni ?? input.config.defaultGcrGni,
      raw_source_payload: sourceRow,
      generated_payload: {
        credits: {
          activity_revenue_taxed: {
            account_code: input.config.activityRevenueCodeTaxed,
            amount: taxedSalesAmount
          },
          sales_tax_applied: {
            account_code: input.config.salesTaxAccountCode,
            amount: salesTaxAmount
          },
          activity_revenue_non_taxed: {
            account_code: input.config.activityRevenueCodeNonTaxed,
            amount: nonTaxedSalesAmount
          }
        },
        debits: {
          lightspeed_fee: {
            account_code: input.config.lightspeedFeeDebitCode,
            amount: feeAmount
          },
          cash_account: {
            account_code: input.config.cashAccountDebitCode,
            amount: payoutAmount
          }
        },
        formulas: {
          payout_formula: 'collected_amount - fee_amount'
        }
      }
    });
  });

  const hasErrors = issues.some((issue) => issue.severity === 'error');

  return {
    reportStatus: hasErrors ? 'failed_validation' : 'processed',
    sourceFileName: input.sourceFileName,
    availableHeaders: input.headers,
    inferredMapping,
    appliedMapping,
    rows: generatedRows,
    issues,
    totals: computeFinanceTotals(generatedRows)
  };
}
