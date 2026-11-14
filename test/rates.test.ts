import { describe, expect, it } from 'vitest';
import { allowedEntryDates, businessToday } from '../src/domain/dates.js';
import { periodOn, planRateChange, type RatePeriod } from '../src/domain/rates.js';

const p = (rate: number, effectiveFrom: string, effectiveTo: string | null = null): RatePeriod => ({ rate, effectiveFrom, effectiveTo });

describe('business dates (fixed UTC−5, Q-HRS-1)', () => {
  it('"today" switches at 05:00 UTC, all year round (no daylight saving)', () => {
    expect(businessToday(new Date('2026-11-14T04:59:00Z'))).toBe('2026-11-13');
    expect(businessToday(new Date('2026-11-14T05:00:00Z'))).toBe('2026-11-14');
    expect(businessToday(new Date('2026-07-14T04:59:00Z'))).toBe('2026-07-13');
  });

  it('R-HRS-2: entries allowed for today and yesterday', () => {
    expect(allowedEntryDates(new Date('2026-11-13T15:00:00Z'))).toEqual(['2026-11-13', '2026-11-12']);
  });

  it('R-HRS-2: on the 1st, only today (no logging into the previous month)', () => {
    expect(allowedEntryDates(new Date('2026-12-01T15:00:00Z'))).toEqual(['2026-12-01']);
    // 02:00 UTC on Dec 1 is still Nov 30 in UTC−5
    expect(allowedEntryDates(new Date('2026-12-01T02:00:00Z'))).toEqual(['2026-11-30', '2026-11-29']);
  });
});

describe('periodOn', () => {
  const history = [p(25, '2000-01-01', '2026-10-31'), p(30, '2026-11-01')];
  it('finds the period covering a date, inclusive at both ends', () => {
    expect(periodOn(history, '2026-10-31')?.rate).toBe(25);
    expect(periodOn(history, '2026-11-01')?.rate).toBe(30);
    expect(periodOn(history, '1999-12-31')).toBeUndefined();
  });
});

describe('planRateChange (R-PAY-6: no retroactive changes)', () => {
  const today = '2026-11-13';

  it('defaults to starting tomorrow and closes the current period today', () => {
    const current = p(25, '2000-01-01');
    const plan = planRateChange([current], 30, today);
    expect(plan.add).toEqual(p(30, '2026-11-14'));
    expect(plan.close).toEqual([{ period: current, effectiveTo: '2026-11-13' }]);
    expect(plan.remove).toEqual([]);
  });

  it('rejects a start date of today or earlier', () => {
    expect(() => planRateChange([], 30, today, '2026-11-13')).toThrow(/retroactively/);
    expect(() => planRateChange([], 30, today, '2026-10-01')).toThrow(/retroactively/);
  });

  it('allows scheduling a future rate', () => {
    const current = p(25, '2000-01-01');
    const plan = planRateChange([current], 30, today, '2026-12-01');
    expect(plan.close).toEqual([{ period: current, effectiveTo: '2026-11-30' }]);
    expect(plan.add.effectiveFrom).toBe('2026-12-01');
  });

  it('replaces a scheduled rate that has not started yet, and never touches closed periods', () => {
    const old = p(20, '2000-01-01', '2025-12-31');
    const current = p(25, '2026-01-01', '2026-11-30');
    const scheduled = p(30, '2026-12-01');
    const plan = planRateChange([old, current, scheduled], 28, today, '2026-11-20');
    expect(plan.remove).toEqual([scheduled]);
    expect(plan.close).toEqual([{ period: current, effectiveTo: '2026-11-19' }]);
    expect(plan.add).toEqual(p(28, '2026-11-20'));
  });

  it('validates the rate', () => {
    expect(() => planRateChange([], -1, today)).toThrow(/≥ 0/);
    expect(() => planRateChange([], 10.005, today)).toThrow(/2 decimals/);
  });
});
