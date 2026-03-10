export function parseCurrency(value: string | null | undefined): number | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;

  const negativeByParens = raw.startsWith('(') && raw.endsWith(')');
  const sanitized = raw
    .replace(/[$,\s]/g, '')
    .replace(/[()]/g, '')
    .replace(/[^0-9.-]/g, '');

  if (!sanitized) return null;

  const parsed = Number(sanitized);
  if (!Number.isFinite(parsed)) return null;

  const normalized = negativeByParens ? -Math.abs(parsed) : parsed;
  return Number(normalized.toFixed(2));
}

export function parseDateToIso(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString().slice(0, 10);
  }

  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const month = Number(slash[1]);
    const day = Number(slash[2]);
    const year = Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]);
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(candidate.getTime())) {
      return candidate.toISOString().slice(0, 10);
    }
  }

  return null;
}

export function normalizeNullableText(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  return text || null;
}
