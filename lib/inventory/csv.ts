import { CatalogUpsertInput } from '@/lib/inventory/types';

const INVENTORY_TO_INPUT_MAP: Record<string, keyof CatalogUpsertInput> = {
  'System ID': 'system_id',
  UPC: 'upc',
  EAN: 'ean',
  'Custom SKU': 'custom_sku',
  'Manufact. SKU': 'manufact_sku',
  Item: 'item_name',
  'Vendor ID': 'vendor_id',
  Price: 'price',
  Tax: 'tax',
  Brand: 'brand',
  'Publish to eCom': 'publish_to_ecom',
  Season: 'season',
  Department: 'department',
  MSRP: 'msrp',
  'Tax Class': 'tax_class',
  'Default Cost': 'default_cost',
  Vendor: 'vendor',
  Category: 'category',
  'Subcategory 1': 'subcategory_1',
  'Subcategory 2': 'subcategory_2',
  'Subcategory 3': 'subcategory_3',
  'Subcategory 4': 'subcategory_4',
  'Subcategory 5': 'subcategory_5',
  'Subcategory 6': 'subcategory_6',
  'Subcategory 7': 'subcategory_7',
  'Subcategory 8': 'subcategory_8',
  'Subcategory 9': 'subcategory_9'
};

function parseCSVLine(line: string): string[] {
  const output: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      output.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  output.push(current);
  return output;
}

export function parseInventoryCsv(input: string): CatalogUpsertInput[] {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  const headers = parseCSVLine(lines[0]).map((header) => header.trim());
  const rows: CatalogUpsertInput[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const columns = parseCSVLine(lines[i]);
    const mapped: Partial<CatalogUpsertInput> = {};

    headers.forEach((header, headerIndex) => {
      const mapKey = INVENTORY_TO_INPUT_MAP[header];
      if (!mapKey) return;
      const raw = columns[headerIndex] ?? '';

      if (mapKey === 'default_cost') {
        const asNumber = Number(raw.trim());
        mapped.default_cost = Number.isFinite(asNumber) ? asNumber : null;
        return;
      }

      (mapped as Record<string, unknown>)[mapKey] = raw.trim();
    });

    if (!mapped.system_id && !mapped.upc && !mapped.ean && !mapped.custom_sku && !mapped.manufact_sku) {
      continue;
    }

    mapped.system_id = mapped.system_id ?? '';
    mapped.item_name = mapped.item_name ?? '';
    rows.push(mapped as CatalogUpsertInput);
  }

  return rows;
}
