import type { SessionUser } from './context.js';
import type { ConsiderationRow, FlagRow, IterationRow } from './queries.js';

// Who may edit what. Everyone signed in can read everything and comment.

export const isManager = (u: SessionUser) => u.role === 'manager';

export const canEditConsideration = (u: SessionUser, c: Pick<ConsiderationRow, 'ownerId' | 'createdBy'>) =>
  isManager(u) || c.ownerId === u.id || c.createdBy === u.id;

export const canEditIteration = (u: SessionUser, i: Pick<IterationRow, 'authorId' | 'considerationOwnerId'>) =>
  isManager(u) || i.authorId === u.id || i.considerationOwnerId === u.id;

/** Request fields (type, assignee, affected domain, what is asked, due date). */
export const canEditFlagRequest = (u: SessionUser, f: Pick<FlagRow, 'raisedById'>) =>
  isManager(u) || f.raisedById === u.id;

/** Response / outcome. */
export const canRespondToFlag = (u: SessionUser, f: Pick<FlagRow, 'assignedToId'>) =>
  isManager(u) || f.assignedToId === u.id;

/** Status, including closing. */
export const canSetFlagStatus = (u: SessionUser, f: Pick<FlagRow, 'assignedToId' | 'raisedById'>) =>
  isManager(u) || f.assignedToId === u.id || f.raisedById === u.id;

/** Create a consideration from a flag, or name a flag as a new consideration's origin. */
export const canSpawnFromFlag = (u: SessionUser, f: Pick<FlagRow, 'assignedToId' | 'raisedById'>) =>
  isManager(u) || f.assignedToId === u.id || f.raisedById === u.id;

/** Closing an iteration is the consideration owner's decision (or a manager's). */
export const canCloseIteration = (u: SessionUser, i: Pick<IterationRow, 'considerationOwnerId'>) =>
  isManager(u) || i.considerationOwnerId === u.id;

/** Review outcome (Approved / Approved with comments / Changes needed): the reviewer, i.e. the assignee. */
export const canSetReviewOutcome = (u: SessionUser, f: Pick<FlagRow, 'assignedToId'>) =>
  isManager(u) || f.assignedToId === u.id;

/** Either side of a flag can bring in the managers. */
export const canEscalateFlag = (u: SessionUser, f: Pick<FlagRow, 'assignedToId' | 'raisedById'>) =>
  isManager(u) || f.assignedToId === u.id || f.raisedById === u.id;
