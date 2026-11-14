import { describe, expect, it } from 'vitest';
import { assertCanEditEntry, isInLockedMonth, lockedBefore } from '../src/domain/entries.js';
import { ForbiddenError, type Principal } from '../src/domain/types.js';

const consultant: Principal = { employeeId: 3, name: 'C', username: 'c', role: 'consultant' };
const management: Principal = { employeeId: 2, name: 'M', username: 'm', role: 'management' };
const accountability: Principal = { employeeId: 1, name: 'A', username: 'a', role: 'accountability' };

const now = new Date('2026-11-14T15:00:00Z'); // 2026-11-14 in UTC−5

describe('R-HRS-10: past months are locked', () => {
  it('the cutoff is the 1st of the current month in UTC−5', () => {
    expect(lockedBefore(now)).toBe('2026-11-01');
    // 03:00 UTC on Dec 1 is still Nov 30 in UTC−5, so November is still open
    expect(lockedBefore(new Date('2026-12-01T03:00:00Z'))).toBe('2026-11-01');
    expect(isInLockedMonth('2026-10-31', now)).toBe(true);
    expect(isInLockedMonth('2026-11-01', now)).toBe(false);
  });

  it('Management can edit entries within the current month', () => {
    expect(() => assertCanEditEntry(management, '2026-11-03', '2026-11-04', now)).not.toThrow();
  });

  it('Management cannot edit an entry in a past month', () => {
    expect(() => assertCanEditEntry(management, '2026-10-31', '2026-10-31', now)).toThrow(ForbiddenError);
  });

  it('Management cannot move an entry into a past month', () => {
    expect(() => assertCanEditEntry(management, '2026-11-03', '2026-10-30', now)).toThrow(/closed month/);
  });

  it('Accountability can edit any month', () => {
    expect(() => assertCanEditEntry(accountability, '2025-01-15', '2025-01-16', now)).not.toThrow();
  });

  it('R-HRS-9: consultants cannot edit entries', () => {
    expect(() => assertCanEditEntry(consultant, '2026-11-14', '2026-11-14', now)).toThrow(ForbiddenError);
  });
});
