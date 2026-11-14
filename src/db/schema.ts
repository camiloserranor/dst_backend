/**
 * Kysely table types for the existing `general` MySQL database.
 *
 * INFERRED from the queries in the legacy PHP and the Angular models — the real schema
 * has not been exported yet. Verify against `SHOW CREATE TABLE` before relying on
 * nullability and column types. Table and column names are kept as-is (Spanish) so the
 * existing database can be used without renaming anything.
 */
import type { Generated } from 'kysely';

export interface EmpleadoTable {
  codigo: Generated<number>;
  nombre: string;
  compania: string | null;
  username: string;
  /** Legacy password (plaintext or unsalted sha256). Never read by the new backend. */
  password: string | null;
  /** 0 = employee, 1 = admin, 2 = owner */
  administrador: number;
  /** Legacy default hourly rate. Superseded by TarifaEmpleado (R-PAY-5); not read by the new backend. */
  rate: number | null;
  /** Added by migrations/001_identity_link.sql: `sub` claim from the identity provider. */
  idp_subject: string | null;
}

export interface ClienteTable {
  codigo: Generated<number>;
  nombre: string;
}

export interface ProyectoTable {
  codigo: Generated<number>;
  codigo_cliente: number;
  nombre: string;
  terminado: number;
}

export interface ChangeOrderTable {
  codigo: Generated<number>;
  codigo_proyecto: number;
  nombre: string;
}

export interface AreaTable {
  codigo: Generated<number>;
  codigo_changeOrder: number;
  nombre: string;
  /** Budgeted hours for the area. */
  limite_horas: number | null;
}

/** Membership of an employee in a project for one role (manager/consultant), with the rate. One row per rate period. */
export interface RolTable {
  codigo_empleado: number;
  codigo_proyecto: number;
  manager: number;
  valor: number | null;
  /** 'hora' = paid by the hour; anything else (or NULL) = not paid hourly. */
  pago: string | null;
  fecha: Generated<string>;
  /** ASSUMED from the "Team accountability" screen (rate history with start/end date). Verify. */
  fecha_inicio: string | null;
  /** ASSUMED. Far-future value (> 2100-01-01) or NULL means "current rate". */
  fecha_fin: string | null;
}

/** Default hourly rate history (R-PAY-5). Added by migrations/002_default_rate_history.sql. */
export interface TarifaEmpleadoTable {
  codigo: Generated<number>;
  codigo_empleado: number;
  valor: number;
  fecha_inicio: string;
  /** Inclusive; NULL = current rate. */
  fecha_fin: string | null;
}

/** One time entry. */
export interface RegistroTable {
  codigo: Generated<number>;
  codigo_empleado: number;
  codigo_cliente: number;
  codigo_proyecto: number;
  codigo_changeOrder: number;
  codigo_area: number;
  horas: number;
  descripcion: string | null;
  fecha: string;
  reg_date: Generated<string>;
  /** 1 if the hours were worked in the manager role (selects the manager rate). */
  admin: number;
}

export interface DB {
  Empleado: EmpleadoTable;
  Cliente: ClienteTable;
  Proyecto: ProyectoTable;
  ChangeOrder: ChangeOrderTable;
  Area: AreaTable;
  Rol: RolTable;
  Registro: RegistroTable;
  TarifaEmpleado: TarifaEmpleadoTable;
}
