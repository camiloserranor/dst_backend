/**
 * Business operations, shared by the REST API and the MCP server.
 * Every method takes the Principal (who is asking) and enforces authorization here,
 * so both entry points get exactly the same rules.
 */
import { businessToday, checkRange, monthRange } from '../domain/dates.js';
import { periodOn } from '../domain/rates.js';
import { calculatePay, type PayResult } from '../domain/pay.js';
import {
  ForbiddenError,
  NotFoundError,
  type Employee,
  type Principal,
  type ProjectNode,
  type TimeEntry,
} from '../domain/types.js';
import type { Repo } from '../db/repo.js';

/** Management (1) or Accountability (2): the "Management" menu. */
const isManagement = (p: Principal) => p.role === 'management' || p.role === 'accountability';
/** Accountability (2): the "Accountability" menu — rates, costs, users. */
const isAccountability = (p: Principal) => p.role === 'accountability';

export interface HoursSummary {
  from: string;
  to: string;
  totalHours: number;
  byProject: { projectId: number; projectName: string; clientName: string; hours: number }[];
  entries: TimeEntry[];
}

export interface ProjectHoursReport {
  project: ProjectNode;
  from: string;
  to: string;
  totalHours: number;
  areas: {
    areaId: number;
    areaName: string;
    changeOrderName: string;
    budgetHours: number | null;
    hours: number;
    remainingHours: number | null;
    byEmployee: { employeeId: number; employeeName: string; hours: number }[];
  }[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function summarize(from: string, to: string, entries: TimeEntry[]): HoursSummary {
  const byProject = new Map<number, HoursSummary['byProject'][number]>();
  for (const e of entries) {
    const p = byProject.get(e.projectId) ?? { projectId: e.projectId, projectName: e.projectName, clientName: e.clientName, hours: 0 };
    p.hours += e.hours;
    byProject.set(e.projectId, p);
  }
  return {
    from,
    to,
    totalHours: round2(entries.reduce((s, e) => s + e.hours, 0)),
    byProject: [...byProject.values()].map((p) => ({ ...p, hours: round2(p.hours) })),
    entries,
  };
}

export type EmployeeView = Employee & {
  /** Current default rate (today, UTC−5). Only filled for Accountability users (R-ACC-4). */
  currentDefaultRate: number | null;
};

export class Services {
  constructor(
    private readonly repo: Repo,
    /** Injectable clock, so "today" can be fixed in tests. */
    private readonly now: () => Date = () => new Date(),
  ) {}

  async whoami(p: Principal) {
    const projects = await this.repo.listProjects({ memberEmployeeId: p.employeeId });
    return { ...p, projects };
  }

  /** Hours of one employee. Consultants only their own (R-ACC-2); Management sees anyone's (R-ACC-3). */
  async employeeHours(p: Principal, employeeId: number, from: string, to: string): Promise<HoursSummary> {
    if (employeeId !== p.employeeId && !isManagement(p)) {
      throw new ForbiddenError("You can only view your own hours.");
    }
    const range = checkRange(from, to);
    const entries = await this.repo.listEntries({ ...range, employeeId });
    return summarize(range.from, range.to, entries);
  }

  async listEmployees(p: Principal): Promise<EmployeeView[]> {
    if (!isManagement(p)) throw new ForbiddenError('Only Management or Accountability users can list employees.');
    const all = await this.repo.listEmployees();
    // Rates are payroll data: only Accountability sees them (R-ACC-4).
    if (!isAccountability(p)) return all.map((e) => ({ ...e, currentDefaultRate: null }));
    const rates = await this.repo.listDefaultRates({});
    const today = businessToday(this.now());
    return all.map((e) => ({
      ...e,
      currentDefaultRate: periodOn(rates.filter((r) => r.employeeId === e.id), today)?.rate ?? null,
    }));
  }

  /** Projects visible to the caller: all for Management, otherwise only the ones they were added to (R-ACC-1). */
  async listProjects(p: Principal): Promise<ProjectNode[]> {
    return this.repo.listProjects(isManagement(p) ? {} : { memberEmployeeId: p.employeeId });
  }

  /**
   * Budget vs. actual per area, broken down by employee (Project dashboard). Management only (R-ACC-3).
   * Being "manager" on a project does not grant this — see Q-ACC-2.
   */
  async projectHours(p: Principal, projectId: number, from: string, to: string): Promise<ProjectHoursReport> {
    if (!isManagement(p)) throw new ForbiddenError('Only Management or Accountability users can view project dashboards.');
    const project = await this.repo.getProject(projectId);
    if (!project) throw new NotFoundError(`Project ${projectId} not found.`);
    const range = checkRange(from, to);
    const [entries, budgets] = await Promise.all([
      this.repo.listEntries({ ...range, projectId }),
      this.repo.listAreaBudgets(projectId),
    ]);

    const areas = new Map<number, ProjectHoursReport['areas'][number]>();
    for (const b of budgets) {
      areas.set(b.areaId, { ...b, hours: 0, remainingHours: null, byEmployee: [] });
    }
    for (const e of entries) {
      const a =
        areas.get(e.areaId) ??
        { areaId: e.areaId, areaName: e.areaName, changeOrderName: e.changeOrderName, budgetHours: null, hours: 0, remainingHours: null, byEmployee: [] };
      a.hours += e.hours;
      const emp = a.byEmployee.find((x) => x.employeeId === e.employeeId);
      if (emp) emp.hours += e.hours;
      else a.byEmployee.push({ employeeId: e.employeeId, employeeName: e.employeeName, hours: e.hours });
      areas.set(e.areaId, a);
    }

    return {
      project,
      ...range,
      totalHours: round2(entries.reduce((s, e) => s + e.hours, 0)),
      areas: [...areas.values()].map((a) => ({
        ...a,
        hours: round2(a.hours),
        remainingHours: a.budgetHours === null ? null : round2(a.budgetHours - a.hours),
        byEmployee: a.byEmployee.map((x) => ({ ...x, hours: round2(x.hours) })),
      })),
    };
  }

  /** Pay estimate for the caller for one month (YYYY-MM). */
  async myPay(p: Principal, month: string): Promise<PayResult & { month: string }> {
    const range = monthRange(month);
    const [entries, rates, defaults] = await Promise.all([
      this.repo.listEntries({ ...range, employeeId: p.employeeId }),
      this.repo.listRates({ employeeId: p.employeeId }),
      this.repo.listDefaultRates({ employeeId: p.employeeId }),
    ]);
    return { month, ...calculatePay(entries, rates, defaults) };
  }

  /** Payroll for everyone for one month (YYYY-MM). Accountability only (R-ACC-4). */
  async monthlyPayroll(p: Principal, month: string): Promise<PayResult & { month: string }> {
    if (!isAccountability(p)) throw new ForbiddenError('Only Accountability users can view payroll.');
    const range = monthRange(month);
    const [entries, rates, defaults] = await Promise.all([
      this.repo.listEntries(range),
      this.repo.listRates({}),
      this.repo.listDefaultRates({}),
    ]);
    return { month, ...calculatePay(entries, rates, defaults) };
  }
}
