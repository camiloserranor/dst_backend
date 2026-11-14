/**
 * Rate history: shared by project rates (Rol) and default rates (TarifaEmpleado).
 *
 *  R-PAY-2 / R-PAY-5  a rate is a period [effectiveFrom, effectiveTo] (inclusive; effectiveTo null = open)
 *  R-PAY-6            no retroactive changes: a new rate must start after today (UTC−5)
 */
import { addDays } from './dates.js';
import { BadRequestError } from './types.js';

export interface RatePeriod {
  rate: number;
  /** YYYY-MM-DD (longer timestamps are accepted; only the date part is used) */
  effectiveFrom: string;
  /** YYYY-MM-DD inclusive, or null if open-ended (the current rate). */
  effectiveTo: string | null;
}

const day = (d: string) => d.slice(0, 10);

/** The period in effect on `date`, if any. If periods overlap (bad data), the latest start wins. */
export function periodOn<P extends RatePeriod>(periods: readonly P[], date: string): P | undefined {
  const d = day(date);
  return periods
    .filter((p) => day(p.effectiveFrom) <= d && (p.effectiveTo === null || d <= day(p.effectiveTo)))
    .sort((a, b) => day(a.effectiveFrom).localeCompare(day(b.effectiveFrom)))
    .at(-1);
}

export interface RateChangePlan<P extends RatePeriod> {
  /** Periods that have started and must be closed the day before the new rate starts. */
  close: { period: P; effectiveTo: string }[];
  /** Future periods that have not started yet and are replaced by the new rate. */
  remove: P[];
  /** The new open-ended period. */
  add: RatePeriod;
}

/**
 * Plan a rate change without touching anything that already happened (R-PAY-6).
 *
 * @param periods  existing history for one employee (default rate) or one employee+project+role
 * @param newRate  USD per hour
 * @param startDate first day of the new rate, YYYY-MM-DD; defaults to tomorrow
 * @param today    business "today" (UTC−5), YYYY-MM-DD
 */
export function planRateChange<P extends RatePeriod>(
  periods: readonly P[],
  newRate: number,
  today: string,
  startDate: string = addDays(today, 1),
): RateChangePlan<P> {
  if (!Number.isFinite(newRate) || newRate < 0) throw new BadRequestError('Rate must be a number ≥ 0.');
  if (Math.round(newRate * 100) !== newRate * 100) throw new BadRequestError('Rate can have at most 2 decimals.');
  if (startDate <= today) {
    throw new BadRequestError(`Rates cannot be changed retroactively: the new rate must start after ${today}.`);
  }

  const dayBefore = addDays(startDate, -1);
  const close: RateChangePlan<P>['close'] = [];
  const remove: P[] = [];

  for (const p of periods) {
    const from = day(p.effectiveFrom);
    const to = p.effectiveTo === null ? null : day(p.effectiveTo);
    if (from >= startDate) {
      // Not started yet (startDate > today), so replacing it changes nothing already worked.
      remove.push(p);
    } else if (to === null || to >= startDate) {
      close.push({ period: p, effectiveTo: dayBefore });
    }
  }

  return { close, remove, add: { rate: newRate, effectiveFrom: startDate, effectiveTo: null } };
}
