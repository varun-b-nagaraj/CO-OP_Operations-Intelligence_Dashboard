'use client';

import { useMemo } from 'react';

import { createBrowserClient } from '@/lib/supabase';

export function useBrowserSupabase() {
  return useMemo(() => createBrowserClient(), []);
}

export function formatRate(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  return `${value.toFixed(1)}%`;
}

export function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10)
  };
}

export function getTodayDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isDateTodayOrPast(dateKey: string, todayKey: string = getTodayDateKey()): boolean {
  return dateKey <= todayKey;
}

export type StudentRow = Record<string, unknown>;

function getFirstStringField(row: StudentRow, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

export function getStudentId(row: StudentRow): string {
  return (
    getFirstStringField(row, ['id', 'student_id', 'studentId']) ?? ''
  );
}

export function getStudentSNumber(row: StudentRow): string {
  return (
    getFirstStringField(row, ['s_number', 'sNumber', 'student_number', 'studentNumber']) ?? ''
  );
}

export function getStudentDisplayName(row: StudentRow): string {
  const directName = getFirstStringField(row, [
    'name',
    'full_name',
    'fullName',
    'student_name',
    'studentName'
  ]);
  if (directName) return directName;

  const firstName = getFirstStringField(row, ['first_name', 'firstName']);
  const lastName = getFirstStringField(row, ['last_name', 'lastName']);
  const combined = [firstName, lastName].filter(Boolean).join(' ').trim();
  if (combined) return combined;

  return getStudentSNumber(row) || getStudentId(row) || 'Unknown';
}
