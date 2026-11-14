/**
 * Rules for changing existing time entries.
 *
 *  R-HRS-6   Management and Accountability can edit anyone's entries.
 *  R-HRS-9   Consultant-level users cannot edit entries (pending Q-HRS-3).
 *  R-HRS-10  Past months are locked: an entry dated before the 1st of the current month
 *            (UTC−5), or an edit that would move an entry there, needs Accountability.
 *  R-HRS-11  Every change is audited (done by the caller that writes the change).
 */
import { businessToday } from './dates.js';
import { ForbiddenError, type Principal } from './types.js';

/** First day of the current business month (UTC−5), YYYY-MM-DD. */
export function lockedBefore(now: Date = new Date()): string {
  return `${businessToday(now).slice(0, 7)}-01`;
}

export function isInLockedMonth(date: string, now: Date = new Date()): boolean {
  return date.slice(0, 10) < lockedBefore(now);
}

/**
 * Throws ForbiddenError unless `p` may change an entry dated `originalDate` so that it ends up
 * dated `newDate` (same as originalDate if the date isn't changing).
 */
export function assertCanEditEntry(p: Principal, originalDate: string, newDate: string, now: Date = new Date()): void {
  if (p.role === 'consultant') {
    throw new ForbiddenError('Only Management or Accountability users can edit entries.');
  }
  if (p.role === 'accountability') return;

  const cutoff = lockedBefore(now);
  if (isInLockedMonth(originalDate, now) || isInLockedMonth(newDate, now)) {
    throw new ForbiddenError(
      `Entries dated before ${cutoff} belong to a closed month and can only be changed by Accountability.`,
    );
  }
}
