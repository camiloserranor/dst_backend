import type { AreaBudget, DefaultRateRecord, Employee, ProjectNode, RateRecord, TimeEntry } from '../domain/types.js';

export interface EntryFilter {
  from: string;
  to: string;
  employeeId?: number;
  projectId?: number;
}

/**
 * Data access. Implementations must use parameterized queries only.
 * No authorization happens here — that is the service layer's job.
 */
export interface Repo {
  findEmployeeBySubject(subject: string): Promise<Employee | undefined>;
  getEmployee(id: number): Promise<Employee | undefined>;
  listEmployees(): Promise<Employee[]>;
  listEntries(filter: EntryFilter): Promise<TimeEntry[]>;
  /** Project rate history (Rol). */
  listRates(filter: { employeeId?: number; projectId?: number }): Promise<RateRecord[]>;
  /** Default rate history (TarifaEmpleado). */
  listDefaultRates(filter: { employeeId?: number }): Promise<DefaultRateRecord[]>;
  listProjects(filter: { memberEmployeeId?: number }): Promise<ProjectNode[]>;
  getProject(id: number): Promise<ProjectNode | undefined>;
  listAreaBudgets(projectId: number): Promise<AreaBudget[]>;
}
