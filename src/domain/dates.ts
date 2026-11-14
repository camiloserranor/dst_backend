import { BadRequestError } from './types.js';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Longest date range a single query may cover, to keep responses bounded. */
export const MAX_RANGE_DAYS = 400;

/** The business time zone: fixed UTC−5, no daylight saving (decision Q-HRS-1). */
export const BUSINESS_UTC_OFFSET_HOURS = -5;

export interface DateRange {
  from: string;
  to: string;
}

function parseDay(s: string): Date {
  if (!DATE_RE.test(s)) throw new BadRequestError(`Invalid date "${s}", expected YYYY-MM-DD`);
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new BadRequestError(`Invalid date "${s}"`);
  }
  return d;
}

/** "2026-03-01" + (-1) → "2026-02-28" */
export function addDays(date: string, days: number): string {
  const d = parseDay(date.slice(0, 10));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Today's date in the business time zone (UTC−5). */
export function businessToday(now: Date = new Date()): string {
  return new Date(now.getTime() + BUSINESS_UTC_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Dates a user may log hours on (R-HRS-2): today, and yesterday unless today is the 1st
 * (so nobody logs into the previous month).
 */
export function allowedEntryDates(now: Date = new Date()): string[] {
  const today = businessToday(now);
  return today.endsWith('-01') ? [today] : [today, addDays(today, -1)];
}

export function checkRange(from: string, to: string): DateRange {
  const a = parseDay(from);
  const b = parseDay(to);
  if (a > b) throw new BadRequestError('"from" must be on or before "to"');
  const days = (b.getTime() - a.getTime()) / 86_400_000;
  if (days > MAX_RANGE_DAYS) throw new BadRequestError(`Range too long (max ${MAX_RANGE_DAYS} days)`);
  return { from, to };
}

/** "2026-10" → { from: "2026-10-01", to: "2026-10-31" } */
export function monthRange(month: string): DateRange {
  if (!MONTH_RE.test(month)) throw new BadRequestError(`Invalid month "${month}", expected YYYY-MM`);
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}
