import { describe, expect, it } from 'vitest';
import { ForbiddenError, type Principal } from '../src/domain/types.js';
import { Services } from '../src/services/services.js';
import { memoryRepo, sampleFixture } from './memoryRepo.js';

const owner: Principal = { employeeId: 1, name: 'Olivia Owner', username: 'owner', role: 'accountability' };
const admin: Principal = { employeeId: 2, name: 'Adam Admin', username: 'admin', role: 'management' };
const emma: Principal = { employeeId: 3, name: 'Emma Employee', username: 'emma', role: 'consultant' };
const max: Principal = { employeeId: 4, name: 'Max Manager', username: 'max', role: 'consultant' };

const svc = () => new Services(memoryRepo(sampleFixture()));

describe('authorization', () => {
  it('R-ACC-2: consultants see only their own hours', async () => {
    expect((await svc().employeeHours(emma, 3, '2026-10-01', '2026-10-31')).totalHours).toBe(12);
    await expect(svc().employeeHours(emma, 4, '2026-10-01', '2026-10-31')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('R-ACC-3: Management can see anyone\'s hours', async () => {
    expect((await svc().employeeHours(admin, 4, '2026-10-01', '2026-10-31')).totalHours).toBe(5);
  });

  it('R-ACC-4: only Accountability sees payroll', async () => {
    await expect(svc().monthlyPayroll(admin, '2026-10')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc().monthlyPayroll(emma, '2026-10')).rejects.toBeInstanceOf(ForbiddenError);
    const payroll = await svc().monthlyPayroll(owner, '2026-10');
    expect(payroll.grandTotal).toBe(8 * 30 + 4 * 32 + 5 * 50);
  });

  it('R-ACC-4: only Accountability sees default rates in the employee list', async () => {
    expect((await svc().listEmployees(admin)).every((e) => e.currentDefaultRate === null)).toBe(true);
    expect((await svc().listEmployees(owner)).find((e) => e.id === 3)?.currentDefaultRate).toBe(30);
    await expect(svc().listEmployees(emma)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('R-ACC-3: project dashboards are for Management only — being project manager is not enough', async () => {
    const report = await svc().projectHours(admin, 20, '2026-10-01', '2026-10-31');
    expect(report.areas[0]).toMatchObject({ budgetHours: 6, hours: 9, remainingHours: -3 });
    await expect(svc().projectHours(max, 20, '2026-10-01', '2026-10-31')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc().projectHours(emma, 20, '2026-10-01', '2026-10-31')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('R-ACC-1: consultants list only projects they were added to; Management lists all', async () => {
    expect((await svc().listProjects(max)).map((p) => p.id)).toEqual([20]);
    expect((await svc().listProjects(admin)).map((p) => p.id)).toEqual([10, 20]);
  });

  it('my pay only includes my own hours', async () => {
    expect((await svc().myPay(emma, '2026-10')).grandTotal).toBe(8 * 30 + 4 * 32);
  });

  it('rejects bad and oversized date ranges', async () => {
    await expect(svc().employeeHours(emma, 3, '2026-13-01', '2026-10-31')).rejects.toThrow(/Invalid date/);
    await expect(svc().employeeHours(emma, 3, '2020-01-01', '2026-10-31')).rejects.toThrow(/Range too long/);
  });
});
