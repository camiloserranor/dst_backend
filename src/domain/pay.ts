/**
 * Pay calculation. Rules (REQUIREMENTS.md, R-PAY-*):
 *
 *  - Every employee has a default hourly rate, with its own history.      R-PAY-1, R-PAY-5
 *  - On a project, the owner can set a project-specific rate per person
 *    and per project role (manager / consultant). Rates have a history:
 *    each one applies from a start date to an end date (open = current). R-PAY-2
 *  - An entry is priced with the project rate for that employee, project
 *    and role that was in effect on the entry's date; if there is none,
 *    the employee's default rate applies.                                R-PAY-3
 *  - Amount = hours × rate, rounded to cents.                             R-PAY-4
 *
 * Pay is always computed from entries × rate history, never stored (R-PAY-7).
 *
 * Hours that cannot be priced (no project rate and no default rate) are reported
 * as warnings instead of being silently priced at 0.
 *
 * Open question Q-PAY-2: the legacy `Rol.pago` column ('hora' or other) is ignored,
 * because the current app never uses it.
 */
import { periodOn } from './rates.js';
import type { DefaultRateRecord, RateRecord, TimeEntry } from './types.js';

export type RateSource = 'project' | 'default' | 'none';

export interface PayLine {
  employeeId: number;
  employeeName: string;
  projectId: number;
  projectName: string;
  asManager: boolean;
  rate: number | null;
  rateSource: RateSource;
  hours: number;
  amount: number;
}

export interface EmployeePayTotal {
  employeeId: number;
  employeeName: string;
  hours: number;
  amount: number;
}

export interface PayResult {
  lines: PayLine[];
  totals: EmployeePayTotal[];
  grandTotal: number;
  warnings: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function resolveRate(
  rates: readonly RateRecord[],
  defaults: readonly DefaultRateRecord[],
  entry: TimeEntry,
): { rate: number | null; source: RateSource } {
  const projectPeriods = rates.filter(
    (r): r is RateRecord & { rate: number } =>
      r.employeeId === entry.employeeId &&
      r.projectId === entry.projectId &&
      r.asManager === entry.asManager &&
      r.rate !== null,
  );
  const project = periodOn(projectPeriods, entry.date);
  if (project) return { rate: project.rate, source: 'project' };

  const fallback = periodOn(defaults.filter((d) => d.employeeId === entry.employeeId), entry.date);
  return fallback ? { rate: fallback.rate, source: 'default' } : { rate: null, source: 'none' };
}

export function calculatePay(
  entries: readonly TimeEntry[],
  rates: readonly RateRecord[],
  defaults: readonly DefaultRateRecord[],
): PayResult {
  const lines = new Map<string, PayLine>();
  const warnings = new Set<string>();

  for (const entry of entries) {
    const { rate, source } = resolveRate(rates, defaults, entry);
    if (source === 'none') {
      warnings.add(`${entry.employeeName}: no project rate and no default rate — some hours on "${entry.projectName}" not priced.`);
    }
    const key = [entry.employeeId, entry.projectId, entry.asManager, rate, source].join('|');
    const line =
      lines.get(key) ??
      ({
        employeeId: entry.employeeId,
        employeeName: entry.employeeName,
        projectId: entry.projectId,
        projectName: entry.projectName,
        asManager: entry.asManager,
        rate,
        rateSource: source,
        hours: 0,
        amount: 0,
      } satisfies PayLine);
    line.hours += entry.hours;
    if (rate !== null) line.amount += entry.hours * rate;
    lines.set(key, line);
  }

  const sortedLines = [...lines.values()]
    .map((l) => ({ ...l, hours: round2(l.hours), amount: round2(l.amount) }))
    .sort(
      (a, b) =>
        a.employeeName.localeCompare(b.employeeName) ||
        a.projectName.localeCompare(b.projectName) ||
        Number(a.asManager) - Number(b.asManager) ||
        (a.rate ?? 0) - (b.rate ?? 0),
    );

  const totalsMap = new Map<number, EmployeePayTotal>();
  for (const l of sortedLines) {
    const t = totalsMap.get(l.employeeId) ?? { employeeId: l.employeeId, employeeName: l.employeeName, hours: 0, amount: 0 };
    t.hours += l.hours;
    t.amount += l.amount;
    totalsMap.set(l.employeeId, t);
  }
  const totals = [...totalsMap.values()].map((t) => ({ ...t, hours: round2(t.hours), amount: round2(t.amount) }));

  return {
    lines: sortedLines,
    totals,
    grandTotal: round2(totals.reduce((s, t) => s + t.amount, 0)),
    warnings: [...warnings],
  };
}
