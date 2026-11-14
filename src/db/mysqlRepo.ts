import { Kysely, MysqlDialect } from 'kysely';
import { createPool } from 'mysql2';
import type { Config } from '../config.js';
import { roleFromLevel, type DefaultRateRecord, type Employee, type ProjectNode, type TimeEntry } from '../domain/types.js';
import type { Repo } from './repo.js';
import type { DB } from './schema.js';

export function createDb(cfg: Config['db']): Kysely<DB> {
  const pool = createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    ssl: cfg.ssl ? { rejectUnauthorized: true, minVersion: 'TLSv1.2' } : undefined,
    connectionLimit: 5,
    // Return DATE/DATETIME as strings (no timezone shifting) and DECIMAL as numbers.
    dateStrings: true,
    decimalNumbers: true,
    timezone: 'Z',
  });
  return new Kysely<DB>({ dialect: new MysqlDialect({ pool }) });
}

const employeeCols = ['codigo', 'nombre', 'username', 'compania', 'administrador'] as const;

function toEmployee(r: {
  codigo: number;
  nombre: string;
  username: string;
  compania: string | null;
  administrador: number;
}): Employee {
  return {
    id: r.codigo,
    name: r.nombre,
    username: r.username,
    company: r.compania,
    role: roleFromLevel(Number(r.administrador)),
  };
}

export function createMysqlRepo(db: Kysely<DB>): Repo {
  const projectQuery = () =>
    db
      .selectFrom('Proyecto as p')
      .innerJoin('Cliente as c', 'c.codigo', 'p.codigo_cliente')
      .select([
        'p.codigo as id',
        'p.nombre as name',
        'p.terminado as finished',
        'c.codigo as clientId',
        'c.nombre as clientName',
      ]);

  const toProject = (r: { id: number; name: string; finished: number; clientId: number; clientName: string }): ProjectNode => ({
    ...r,
    finished: Boolean(Number(r.finished)),
  });

  return {
    async findEmployeeBySubject(subject) {
      const r = await db.selectFrom('Empleado').select(employeeCols).where('idp_subject', '=', subject).executeTakeFirst();
      return r && toEmployee(r);
    },

    async getEmployee(id) {
      const r = await db.selectFrom('Empleado').select(employeeCols).where('codigo', '=', id).executeTakeFirst();
      return r && toEmployee(r);
    },

    async listEmployees() {
      const rows = await db.selectFrom('Empleado').select(employeeCols).orderBy('nombre').execute();
      return rows.map(toEmployee);
    },

    async listEntries(f) {
      let q = db
        .selectFrom('Registro as r')
        .innerJoin('Empleado as e', 'e.codigo', 'r.codigo_empleado')
        .innerJoin('Proyecto as p', 'p.codigo', 'r.codigo_proyecto')
        .innerJoin('Cliente as c', 'c.codigo', 'p.codigo_cliente')
        .leftJoin('ChangeOrder as co', 'co.codigo', 'r.codigo_changeOrder')
        .leftJoin('Area as a', 'a.codigo', 'r.codigo_area')
        .select([
          'r.codigo as id',
          'r.codigo_empleado as employeeId',
          'e.nombre as employeeName',
          'c.codigo as clientId',
          'c.nombre as clientName',
          'p.codigo as projectId',
          'p.nombre as projectName',
          'r.codigo_changeOrder as changeOrderId',
          'co.nombre as changeOrderName',
          'r.codigo_area as areaId',
          'a.nombre as areaName',
          'r.horas as hours',
          'r.descripcion as description',
          'r.fecha as date',
          'r.admin as admin',
        ])
        // fecha may be DATETIME: compare on the date part via a half-open range.
        .where('r.fecha', '>=', f.from)
        .where('r.fecha', '<', nextDay(f.to))
        .orderBy('r.fecha')
        .orderBy('r.codigo');
      if (f.employeeId !== undefined) q = q.where('r.codigo_empleado', '=', f.employeeId);
      if (f.projectId !== undefined) q = q.where('r.codigo_proyecto', '=', f.projectId);

      const rows = await q.execute();
      return rows.map(
        (r): TimeEntry => ({
          id: r.id,
          employeeId: r.employeeId,
          employeeName: r.employeeName,
          clientId: r.clientId,
          clientName: r.clientName,
          projectId: r.projectId,
          projectName: r.projectName,
          changeOrderId: r.changeOrderId,
          changeOrderName: r.changeOrderName ?? '',
          areaId: r.areaId,
          areaName: r.areaName ?? '',
          hours: Number(r.hours),
          description: r.description,
          date: String(r.date).slice(0, 10),
          asManager: Number(r.admin) === 1,
        }),
      );
    },

    async listRates(f) {
      let q = db.selectFrom('Rol').select(['codigo_empleado', 'codigo_proyecto', 'manager', 'valor', 'fecha', 'fecha_inicio', 'fecha_fin']);
      if (f.employeeId !== undefined) q = q.where('codigo_empleado', '=', f.employeeId);
      if (f.projectId !== undefined) q = q.where('codigo_proyecto', '=', f.projectId);
      const rows = await q.execute();
      return rows.map((r) => ({
        employeeId: r.codigo_empleado,
        projectId: r.codigo_proyecto,
        asManager: Number(r.manager) === 1,
        rate: r.valor === null ? null : Number(r.valor),
        // ASSUMPTION until the schema arrives: the app shows a start and end date per rate
        // (fecha_inicio / fecha_fin, "current" when fecha_fin is far in the future). Gen 1 only had `fecha`.
        effectiveFrom: String(r.fecha_inicio ?? r.fecha ?? '0000-00-00').slice(0, 10),
        effectiveTo: r.fecha_fin && String(r.fecha_fin) < '2100-01-01' ? String(r.fecha_fin).slice(0, 10) : null,
      }));
    },

    async listDefaultRates(f) {
      let q = db.selectFrom('TarifaEmpleado').select(['codigo_empleado', 'valor', 'fecha_inicio', 'fecha_fin']);
      if (f.employeeId !== undefined) q = q.where('codigo_empleado', '=', f.employeeId);
      const rows = await q.execute();
      return rows.map(
        (r): DefaultRateRecord => ({
          employeeId: r.codigo_empleado,
          rate: Number(r.valor),
          effectiveFrom: String(r.fecha_inicio).slice(0, 10),
          effectiveTo: r.fecha_fin === null ? null : String(r.fecha_fin).slice(0, 10),
        }),
      );
    },

    async listProjects(f) {
      let q = projectQuery().orderBy('c.nombre').orderBy('p.nombre');
      if (f.memberEmployeeId !== undefined) {
        const member = f.memberEmployeeId;
        q = q.where(({ exists, selectFrom }) =>
          exists(
            selectFrom('Rol as rl')
              .select('rl.codigo_proyecto')
              .whereRef('rl.codigo_proyecto', '=', 'p.codigo')
              .where('rl.codigo_empleado', '=', member),
          ),
        );
      }
      return (await q.execute()).map(toProject);
    },

    async getProject(id) {
      const r = await projectQuery().where('p.codigo', '=', id).executeTakeFirst();
      return r && toProject(r);
    },


    async listAreaBudgets(projectId) {
      const rows = await db
        .selectFrom('Area as a')
        .innerJoin('ChangeOrder as co', 'co.codigo', 'a.codigo_changeOrder')
        .select([
          'a.codigo as areaId',
          'a.nombre as areaName',
          'co.codigo as changeOrderId',
          'co.nombre as changeOrderName',
          'a.limite_horas as budgetHours',
        ])
        .where('co.codigo_proyecto', '=', projectId)
        .orderBy('co.nombre')
        .orderBy('a.nombre')
        .execute();
      return rows.map((r) => ({ ...r, budgetHours: r.budgetHours === null ? null : Number(r.budgetHours) }));
    },
  };
}

function nextDay(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}
