import { z } from 'zod';

export const FinanceReportStatusSchema = z.enum([
  'draft',
  'processed',
  'saved',
  'exported',
  'failed_validation'
]);

export const FinanceIssueSeveritySchema = z.enum(['info', 'warning', 'error']);

export const FinanceColumnKeySchema = z.enum([
  'business_sales_date',
  'payout_date',
  'collected_amount',
  'fee_amount',
  'payout_amount',
  'taxed_sales_amount',
  'sales_tax_amount',
  'non_taxed_sales_amount',
  'ach_bank_date',
  'gcr_gni'
]);

export const FinanceColumnMappingSchema = z.object({
  business_sales_date: z.string().trim().min(1).optional(),
  payout_date: z.string().trim().min(1).optional(),
  collected_amount: z.string().trim().min(1).optional(),
  fee_amount: z.string().trim().min(1).optional(),
  payout_amount: z.string().trim().min(1).optional(),
  taxed_sales_amount: z.string().trim().min(1).optional(),
  sales_tax_amount: z.string().trim().min(1).optional(),
  non_taxed_sales_amount: z.string().trim().min(1).optional(),
  ach_bank_date: z.string().trim().min(1).optional(),
  gcr_gni: z.string().trim().min(1).optional()
});

export const FinanceGeneratedRowSchema = z.object({
  row_index: z.coerce.number().int().nonnegative(),
  business_sales_date: z.string().date(),
  payout_date: z.string().date().nullable(),
  collected_amount: z.coerce.number(),
  fee_amount: z.coerce.number(),
  payout_amount: z.coerce.number(),
  taxed_sales_amount: z.coerce.number(),
  sales_tax_amount: z.coerce.number(),
  non_taxed_sales_amount: z.coerce.number(),
  lightspeed_fee_debit: z.coerce.number(),
  cash_account_debit: z.coerce.number(),
  ach_bank_date: z.string().date().nullable(),
  gcr_gni: z.string().trim().max(64).nullable(),
  raw_source_payload: z.record(z.string(), z.string()),
  generated_payload: z.record(z.string(), z.unknown())
});

export const FinanceValidationIssueSchema = z.object({
  row_index: z.number().int().nonnegative().nullable(),
  severity: FinanceIssueSeveritySchema,
  message: z.string().trim().min(1),
  field_name: z.string().trim().min(1).nullable(),
  raw_value: z.string().nullable()
});

export const FinanceSaveReportSchema = z.object({
  reportName: z.string().trim().min(1).max(200),
  schoolYearLabel: z.string().trim().max(40).optional(),
  sourceFileName: z.string().trim().min(1).max(255),
  sourceCsvText: z.string().min(1),
  reportPeriodStart: z.string().date().nullable().optional(),
  reportPeriodEnd: z.string().date().nullable().optional(),
  notes: z.string().trim().max(2000).optional(),
  uploadedBy: z.string().trim().max(120).optional(),
  status: FinanceReportStatusSchema.optional(),
  rows: z.array(FinanceGeneratedRowSchema),
  issues: z.array(FinanceValidationIssueSchema),
  appliedMapping: FinanceColumnMappingSchema.optional()
});

export const FinanceReportsQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: FinanceReportStatusSchema.optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  schoolYear: z.string().trim().max(40).optional(),
  uploadedBy: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
});
