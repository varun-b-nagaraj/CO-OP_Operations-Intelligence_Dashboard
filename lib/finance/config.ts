import { SupabaseClient } from '@supabase/supabase-js';

import { FinanceTransformationConfig } from '@/lib/finance/types';

const DEFAULT_CONFIG: FinanceTransformationConfig = {
  activityRevenueCodeTaxed: 'ACTIVITY_REVENUE_TAXED',
  activityRevenueCodeNonTaxed: 'ACTIVITY_REVENUE_NON_TAXED',
  salesTaxAccountCode: 'SALES_TAX_APPLIED',
  lightspeedFeeDebitCode: 'LIGHTSPEED_FEE',
  cashAccountDebitCode: 'CASH_ACCOUNT',
  defaultGcrGni: 'GCR'
};

export async function loadFinanceTransformationConfig(
  supabase: SupabaseClient
): Promise<FinanceTransformationConfig> {
  const { data, error } = await supabase
    .from('finance_report_config')
    .select('config_key, config_value')
    .in('config_key', [
      'activityRevenueCodeTaxed',
      'activityRevenueCodeNonTaxed',
      'salesTaxAccountCode',
      'lightspeedFeeDebitCode',
      'cashAccountDebitCode',
      'defaultGcrGni'
    ]);

  if (error || !data) {
    return DEFAULT_CONFIG;
  }

  const mapped: Record<string, unknown> = {};
  for (const row of data) {
    mapped[String(row.config_key)] = row.config_value;
  }

  return {
    activityRevenueCodeTaxed:
      typeof mapped.activityRevenueCodeTaxed === 'string'
        ? mapped.activityRevenueCodeTaxed
        : DEFAULT_CONFIG.activityRevenueCodeTaxed,
    activityRevenueCodeNonTaxed:
      typeof mapped.activityRevenueCodeNonTaxed === 'string'
        ? mapped.activityRevenueCodeNonTaxed
        : DEFAULT_CONFIG.activityRevenueCodeNonTaxed,
    salesTaxAccountCode:
      typeof mapped.salesTaxAccountCode === 'string'
        ? mapped.salesTaxAccountCode
        : DEFAULT_CONFIG.salesTaxAccountCode,
    lightspeedFeeDebitCode:
      typeof mapped.lightspeedFeeDebitCode === 'string'
        ? mapped.lightspeedFeeDebitCode
        : DEFAULT_CONFIG.lightspeedFeeDebitCode,
    cashAccountDebitCode:
      typeof mapped.cashAccountDebitCode === 'string'
        ? mapped.cashAccountDebitCode
        : DEFAULT_CONFIG.cashAccountDebitCode,
    defaultGcrGni:
      typeof mapped.defaultGcrGni === 'string' ? mapped.defaultGcrGni : DEFAULT_CONFIG.defaultGcrGni
  };
}

export function getDefaultFinanceTransformationConfig(): FinanceTransformationConfig {
  return DEFAULT_CONFIG;
}
