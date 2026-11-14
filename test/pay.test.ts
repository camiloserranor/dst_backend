import { describe, expect, it } from 'vitest';
import { calculatePay } from '../src/domain/pay.js';
import type { DefaultRateRecord } from '../src/domain/types.js';
import { entry, rate } from './memoryRepo.js';

const noDefaults: DefaultRateRecord[] = [];
const defaultRate = (employeeId: number, rate: number, effectiveFrom = '2000-01-01', effectiveTo: string | null = null): DefaultRateRecord => ({
  employeeId,
  rate,
  effectiveFrom,
  effectiveTo,
});

describe('calculatePay', () => {
  it('R-PAY-3: uses the project rate in effect for that employee and project', () => {
    const r = calculatePay(
      [entry({ employeeId: 1, projectId: 10, hours: 8, date: '2026-10-01' }), entry({ employeeId: 1, projectId: 10, hours: 2.5, date: '2026-10-02' })],
      [rate({ employeeId: 1, projectId: 10, rate: 40, effectiveFrom: '2026-01-01' })],
      [defaultRate(1, 25)],
    );
    expect(r.totals).toEqual([{ employeeId: 1, employeeName: 'Emp 1', hours: 10.5, amount: 420 }]);
    expect(r.lines[0]).toMatchObject({ rateSource: 'project', rate: 40 });
    expect(r.warnings).toEqual([]);
  });

  it('R-PAY-3: falls back to the default rate when there is no project rate', () => {
    const r = calculatePay([entry({ employeeId: 1, projectId: 10, hours: 10, date: '2026-10-01' })], [], [defaultRate(1, 25)]);
    expect(r.lines[0]).toMatchObject({ rateSource: 'default', rate: 25, amount: 250 });
  });

  it('R-PAY-2: a project rate that has ended no longer applies (default rate takes over)', () => {
    const r = calculatePay(
      [entry({ employeeId: 1, projectId: 10, hours: 1, date: '2026-09-30' }), entry({ employeeId: 1, projectId: 10, hours: 1, date: '2026-10-01' })],
      [rate({ employeeId: 1, projectId: 10, rate: 40, effectiveFrom: '2026-01-01', effectiveTo: '2026-09-30' })],
      [defaultRate(1, 25)],
    );
    expect(r.lines.map((l) => [l.rateSource, l.amount])).toEqual([['default', 25], ['project', 40]]);
  });

  it('R-PAY-2: rate changes apply by date instead of re-pricing the whole month', () => {
    const r = calculatePay(
      [entry({ employeeId: 1, projectId: 10, hours: 10, date: '2026-10-10' }), entry({ employeeId: 1, projectId: 10, hours: 10, date: '2026-10-20' })],
      [
        rate({ employeeId: 1, projectId: 10, rate: 40, effectiveFrom: '2026-01-01', effectiveTo: '2026-10-14' }),
        rate({ employeeId: 1, projectId: 10, rate: 50, effectiveFrom: '2026-10-15 00:00:00' }),
      ],
      noDefaults,
    );
    expect(r.lines.map((l) => [l.rate, l.hours, l.amount])).toEqual([[40, 10, 400], [50, 10, 500]]);
    expect(r.grandTotal).toBe(900);
  });

  it('never uses another employee\'s rate on the same project (legacy bug)', () => {
    const r = calculatePay(
      [entry({ employeeId: 1, projectId: 10, hours: 10, date: '2026-10-01' })],
      [
        rate({ employeeId: 1, projectId: 10, rate: 40, effectiveFrom: '2026-01-01' }),
        rate({ employeeId: 2, projectId: 10, rate: 99, effectiveFrom: '2026-09-01' }),
      ],
      noDefaults,
    );
    expect(r.grandTotal).toBe(400);
  });

  it('R-PAY-2: manager and consultant rates are separate', () => {
    const r = calculatePay(
      [entry({ employeeId: 1, projectId: 10, hours: 2, date: '2026-10-01', asManager: true }), entry({ employeeId: 1, projectId: 10, hours: 3, date: '2026-10-01' })],
      [
        rate({ employeeId: 1, projectId: 10, rate: 40, effectiveFrom: '2026-01-01' }),
        rate({ employeeId: 1, projectId: 10, rate: 60, effectiveFrom: '2026-01-01', asManager: true }),
      ],
      noDefaults,
    );
    expect(r.grandTotal).toBe(2 * 60 + 3 * 40);
  });

  it('a manager entry with only a consultant rate uses the default rate, not the consultant rate', () => {
    const r = calculatePay(
      [entry({ employeeId: 1, projectId: 10, hours: 1, date: '2026-10-01', asManager: true })],
      [rate({ employeeId: 1, projectId: 10, rate: 40, effectiveFrom: '2026-01-01' })],
      [defaultRate(1, 25)],
    );
    expect(r.lines[0]).toMatchObject({ rateSource: 'default', amount: 25 });
  });

  it('R-PAY-5: default rate history — a raise only applies from its start date', () => {
    const r = calculatePay(
      [entry({ employeeId: 1, projectId: 10, hours: 10, date: '2026-10-31' }), entry({ employeeId: 1, projectId: 10, hours: 10, date: '2026-11-01' })],
      [],
      [defaultRate(1, 25, '2000-01-01', '2026-10-31'), defaultRate(1, 30, '2026-11-01')],
    );
    expect(r.lines.map((l) => [l.rate, l.amount])).toEqual([[25, 250], [30, 300]]);
  });

  it('warns instead of guessing when there is no rate at all', () => {
    const r = calculatePay([entry({ employeeId: 1, projectId: 10, hours: 5, date: '2026-10-01' })], [], noDefaults);
    expect(r.grandTotal).toBe(0);
    expect(r.lines[0]).toMatchObject({ rateSource: 'none', hours: 5 });
    expect(r.warnings[0]).toMatch(/not priced/);
  });

  it('R-PAY-4: rounds to cents', () => {
    const r = calculatePay(
      [entry({ employeeId: 1, projectId: 10, hours: 0.1, date: '2026-10-01' }), entry({ employeeId: 1, projectId: 10, hours: 0.2, date: '2026-10-01' })],
      [rate({ employeeId: 1, projectId: 10, rate: 33.33, effectiveFrom: '2026-01-01' })],
      noDefaults,
    );
    expect(r.grandTotal).toBe(10);
  });
});
