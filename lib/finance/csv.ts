function parseCsvLine(line: string): string[] {
  const output: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
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

export interface ParsedCsvResult {
  headers: string[];
  rows: Array<Record<string, string>>;
}

export function parseCsv(text: string): ParsedCsvResult {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (!lines.length) {
    return { headers: [], rows: [] };
  }

  const headers = parseCsvLine(lines[0]).map((header, index) => {
    const trimmed = header.trim();
    return trimmed || `column_${index + 1}`;
  });

  const rows: Array<Record<string, string>> = [];

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const values = parseCsvLine(lines[lineIndex]);
    const row: Record<string, string> = {};

    headers.forEach((header, headerIndex) => {
      row[header] = (values[headerIndex] ?? '').trim();
    });

    rows.push(row);
  }

  return { headers, rows };
}

function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findHeader(headers: string[], candidates: string[]): string | undefined {
  const indexed = new Map(headers.map((header) => [normalizeHeader(header), header]));

  for (const candidate of candidates) {
    const match = indexed.get(normalizeHeader(candidate));
    if (match) return match;
  }

  for (const header of headers) {
    const normalized = normalizeHeader(header);
    if (candidates.some((candidate) => normalized.includes(normalizeHeader(candidate)))) {
      return header;
    }
  }

  return undefined;
}

export function inferFinanceMapping(headers: string[]) {
  return {
    business_sales_date: findHeader(headers, ['business sales date', 'sales date', 'date']),
    payout_date: findHeader(headers, ['payout date', 'settlement date']),
    collected_amount: findHeader(headers, ['collected', 'gross sales', 'gross', 'amount collected']),
    fee_amount: findHeader(headers, ['fee', 'fees', 'processing fee', 'lightspeed fee']),
    payout_amount: findHeader(headers, ['payout', 'net payout']),
    taxed_sales_amount: findHeader(headers, ['taxed sales', 'card taxed sales', 'taxable sales']),
    sales_tax_amount: findHeader(headers, ['sales tax', 'tax collected', 'tax amount']),
    non_taxed_sales_amount: findHeader(headers, ['non taxed sales', 'non taxable sales', 'nontax sales']),
    ach_bank_date: findHeader(headers, ['ach bank date', 'ach date', 'bank date']),
    gcr_gni: findHeader(headers, ['gcr gni', 'gcr/gni', 'journal'])
  } as const;
}
