import { InventoryCatalogItem } from '@/lib/inventory/types';

export const IDENTIFIER_PRIORITY = ['upc', 'ean', 'system_id', 'custom_sku', 'manufact_sku'] as const;

export type IdentifierKey = (typeof IDENTIFIER_PRIORITY)[number];

export function normalizeIdentifier(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export function inventoryIdentifierMap(item: Pick<InventoryCatalogItem, IdentifierKey>): Record<IdentifierKey, string> {
  return {
    upc: normalizeIdentifier(item.upc),
    ean: normalizeIdentifier(item.ean),
    system_id: normalizeIdentifier(item.system_id),
    custom_sku: normalizeIdentifier(item.custom_sku),
    manufact_sku: normalizeIdentifier(item.manufact_sku)
  };
}

export function resolveCatalogItemByCode(
  items: InventoryCatalogItem[],
  rawCode: string
): { item: InventoryCatalogItem | null; key: IdentifierKey | null } {
  const code = normalizeIdentifier(rawCode);
  if (!code) {
    return { item: null, key: null };
  }

  for (const key of IDENTIFIER_PRIORITY) {
    const found = items.find((item) => inventoryIdentifierMap(item)[key] === code);
    if (found) {
      return { item: found, key };
    }
  }

  return { item: null, key: null };
}
