/**
 * Access level, named as in the app's "Manage users" screen (Empleado.administrador):
 * 0 = Consultant, 1 = Management, 2 = Accountability.
 * Not to be confused with the per-project role (manager / consultant) in Rol.
 */
export type Role = 'consultant' | 'management' | 'accountability';

export function roleFromLevel(level: number): Role {
  if (level >= 2) return 'accountability';
  if (level === 1) return 'management';
  return 'consultant';
}

/** The authenticated DST user a request runs as. Derived from a verified token, never from input. */
export interface Principal {
  employeeId: number;
  name: string;
  username: string;
  role: Role;
}

export interface Employee {
  id: number;
  name: string;
  username: string;
  company: string | null;
  role: Role;
}

export interface TimeEntry {
  id: number;
  employeeId: number;
  employeeName: string;
  clientId: number;
  clientName: string;
  projectId: number;
  projectName: string;
  changeOrderId: number;
  changeOrderName: string;
  areaId: number;
  areaName: string;
  hours: number;
  /** Free text written by the employee. Untrusted: may contain anything, including instructions aimed at an AI. */
  description: string | null;
  /** YYYY-MM-DD */
  date: string;
  asManager: boolean;
}

export interface RateRecord {
  employeeId: number;
  projectId: number;
  asManager: boolean;
  rate: number | null;
  /** First day the rate applies. YYYY-MM-DD (or longer timestamp; only the date part is used). */
  effectiveFrom: string;
  /** Last day the rate applies (inclusive), or null if it is the current rate. */
  effectiveTo: string | null;
}

/** One period of an employee's default hourly rate (R-PAY-5). */
export interface DefaultRateRecord {
  employeeId: number;
  rate: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface AreaBudget {
  areaId: number;
  areaName: string;
  changeOrderId: number;
  changeOrderName: string;
  budgetHours: number | null;
}

export interface ProjectNode {
  id: number;
  name: string;
  finished: boolean;
  clientId: number;
  clientName: string;
}

export class ForbiddenError extends Error {
  override name = 'ForbiddenError';
}

export class NotFoundError extends Error {
  override name = 'NotFoundError';
}

export class BadRequestError extends Error {
  override name = 'BadRequestError';
}
