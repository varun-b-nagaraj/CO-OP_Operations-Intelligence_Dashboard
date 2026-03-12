'use client';

import { useEffect } from 'react';

type SortDirection = 'desc' | 'asc';

const SORT_INDICATOR_ATTR = 'data-global-sort-indicator';
const SORTABLE_TH_ATTR = 'data-global-sortable-th';

function parseNumeric(text: string): number | null {
  const normalized = text
    .replace(/\u00a0/g, ' ')
    .replace(/[,$%]/g, '')
    .replace(/[()]/g, '')
    .trim();
  if (!normalized) return null;
  const sign = text.includes('(') && text.includes(')') ? -1 : 1;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return value * sign;
}

function parseDateValue(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

function getCellText(row: HTMLTableRowElement, columnIndex: number): string {
  const cell = row.cells.item(columnIndex);
  if (!cell) return '';
  return (cell.textContent ?? '').trim();
}

function detectComparator(rows: HTMLTableRowElement[], columnIndex: number) {
  const values = rows.map((row) => getCellText(row, columnIndex)).filter(Boolean);
  if (values.length === 0) {
    return (a: HTMLTableRowElement, b: HTMLTableRowElement) =>
      getCellText(a, columnIndex).localeCompare(getCellText(b, columnIndex), undefined, { numeric: true });
  }

  const numericCount = values.filter((value) => parseNumeric(value) !== null).length;
  const dateCount = values.filter((value) => parseDateValue(value) !== null).length;

  if (numericCount / values.length >= 0.8) {
    return (a: HTMLTableRowElement, b: HTMLTableRowElement) => {
      const aNum = parseNumeric(getCellText(a, columnIndex));
      const bNum = parseNumeric(getCellText(b, columnIndex));
      if (aNum === null && bNum === null) return 0;
      if (aNum === null) return 1;
      if (bNum === null) return -1;
      return aNum - bNum;
    };
  }

  if (dateCount / values.length >= 0.8) {
    return (a: HTMLTableRowElement, b: HTMLTableRowElement) => {
      const aDate = parseDateValue(getCellText(a, columnIndex));
      const bDate = parseDateValue(getCellText(b, columnIndex));
      if (aDate === null && bDate === null) return 0;
      if (aDate === null) return 1;
      if (bDate === null) return -1;
      return aDate - bDate;
    };
  }

  return (a: HTMLTableRowElement, b: HTMLTableRowElement) =>
    getCellText(a, columnIndex).localeCompare(getCellText(b, columnIndex), undefined, { numeric: true, sensitivity: 'base' });
}

function updateHeaderIndicators(table: HTMLTableElement, activeColumn: number, direction: SortDirection) {
  const headers = Array.from(table.querySelectorAll(`th[${SORTABLE_TH_ATTR}="true"]`));
  for (const header of headers) {
    const index = Number(header.getAttribute('data-global-sort-column-index') ?? '-1');
    const indicator = header.querySelector<HTMLSpanElement>(`span[${SORT_INDICATOR_ATTR}="true"]`);
    if (!indicator) continue;
    if (index !== activeColumn) {
      indicator.textContent = '↕';
      header.setAttribute('aria-sort', 'none');
      continue;
    }
    indicator.textContent = direction === 'desc' ? '↓' : '↑';
    header.setAttribute('aria-sort', direction === 'desc' ? 'descending' : 'ascending');
  }
}

function sortTable(table: HTMLTableElement, columnIndex: number, direction: SortDirection) {
  const tbody = table.tBodies.item(0);
  if (!tbody) return;
  const rows = Array.from(tbody.rows);
  if (rows.length <= 1) return;

  const comparator = detectComparator(rows, columnIndex);
  rows.sort((left, right) => {
    const result = comparator(left, right);
    return direction === 'desc' ? -result : result;
  });

  for (const row of rows) {
    tbody.appendChild(row);
  }
}

function makeTablesSortable() {
  const tables = Array.from(document.querySelectorAll<HTMLTableElement>('table'));

  for (const table of tables) {
    if (table.dataset.globalSortEnabled === 'true') continue;

    const headerRow = table.querySelector('thead tr');
    if (!headerRow) continue;

    const headers = Array.from(headerRow.querySelectorAll('th'));
    if (headers.length === 0) continue;

    table.dataset.globalSortEnabled = 'true';
    table.dataset.globalSortColumn = '-1';
    table.dataset.globalSortDirection = 'desc';

    headers.forEach((header, index) => {
      header.setAttribute(SORTABLE_TH_ATTR, 'true');
      header.setAttribute('data-global-sort-column-index', String(index));
      header.classList.add('cursor-pointer', 'select-none');
      header.setAttribute('aria-sort', 'none');
      header.title = 'Click to sort';

      const indicator = document.createElement('span');
      indicator.setAttribute(SORT_INDICATOR_ATTR, 'true');
      indicator.className = 'ml-1 inline-block text-[10px] text-neutral-500';
      indicator.textContent = '↕';
      header.appendChild(indicator);
    });
  }
}

export function GlobalTableSorter() {
  useEffect(() => {
    makeTablesSortable();

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const header = target.closest<HTMLTableCellElement>(`th[${SORTABLE_TH_ATTR}="true"]`);
      if (!header) return;

      const table = header.closest('table');
      if (!table) return;

      const columnIndex = Number(header.getAttribute('data-global-sort-column-index') ?? '-1');
      if (!Number.isInteger(columnIndex) || columnIndex < 0) return;

      const currentColumn = Number(table.dataset.globalSortColumn ?? '-1');
      const nextDirection: SortDirection =
        currentColumn === columnIndex
          ? ((table.dataset.globalSortDirection === 'desc' ? 'asc' : 'desc') as SortDirection)
          : 'desc';

      table.dataset.globalSortColumn = String(columnIndex);
      table.dataset.globalSortDirection = nextDirection;

      sortTable(table, columnIndex, nextDirection);
      updateHeaderIndicators(table, columnIndex, nextDirection);
    };

    const observer = new MutationObserver(() => {
      makeTablesSortable();
    });

    document.addEventListener('click', handleClick);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      document.removeEventListener('click', handleClick);
      observer.disconnect();
    };
  }, []);

  return null;
}
