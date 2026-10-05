export interface User {
  id: number;
  name: string;
  email: string | null;
  role: 'manager' | 'designer';
  active: number;
}

export interface Me {
  id: number;
  name: string;
  email: string | null;
  role: 'manager' | 'designer';
  mustChangePassword: boolean;
}

export interface Domain {
  id: number;
  code: string;
  name: string;
  ownerId: number | null;
  ownerName: string | null;
  colour: string;
  sortOrder: number;
  active: number;
  version: number;
  used: number;
}

export interface Subsystem {
  id: number;
  domainId: number;
  name: string;
  sortOrder: number;
  active: number;
  version: number;
}

export type LookupCategory = 'verdict' | 'iteration_status' | 'flag_status' | 'flag_type' | 'consideration_status';

export interface Lookup {
  id: number;
  category: LookupCategory;
  label: string;
  behaviour: string;
  colour: string | null;
  sortOrder: number;
  isDefault: number;
  active: number;
  version: number;
}

export interface Meta {
  domains: Domain[];
  subsystems: Subsystem[];
  users: User[];
  lookups: Lookup[];
  follows: Array<{ entityType: 'consideration' | 'domain'; entityId: string }>;
}

export interface Consideration {
  id: string;
  domainId: number;
  domainCode: string;
  domainName: string;
  domainColour: string;
  subsystemId: number;
  subsystemName: string;
  title: string;
  targetMetric: string;
  ownerId: number;
  ownerName: string;
  originFlagId: string | null;
  statusId: number;
  statusLabel: string;
  statusBehaviour: string;
  notes: string;
  createdBy: number;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  iterationCount: number;
  latestIterationId: string | null;
  latestVerdictLabel: string | null;
  latestVerdictBehaviour: string | null;
  openFlagCount: number;
  lastActivityAt: string | null;
}

export interface Iteration {
  id: string;
  considerationId: string;
  considerationTitle: string;
  targetMetric: string;
  domainId: number;
  domainCode: string;
  domainColour: string;
  subsystemId: number;
  subsystemName: string;
  considerationOwnerId: number;
  parentIterationId: string | null;
  parentFlagId: string | null;
  date: string;
  authorId: number;
  authorName: string;
  designInput: string;
  cadDesign: string;
  analyticalResults: string;
  simulationResults: string;
  evidenceLink: string;
  verdictId: number | null;
  verdictLabel: string | null;
  verdictBehaviour: string | null;
  statusId: number;
  statusLabel: string;
  statusBehaviour: string;
  nextAction: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  flagCount: number;
  openFlagCount: number;
  closeOverrideReason: string | null;
  reviewCount: number;
  reviewApprovedCount: number;
  reviewChangesNeededCount: number;
}

export interface Flag {
  id: string;
  iterationId: string;
  considerationId: string;
  considerationTitle: string;
  sourceDomainId: number;
  sourceDomainCode: string;
  sourceDomainColour: string;
  sourceSubsystemName: string;
  sourceTargetMetric: string;
  sourceVerdictLabel: string | null;
  sourceVerdictBehaviour: string | null;
  raisedById: number;
  raisedByName: string;
  dateRaised: string;
  typeId: number;
  typeLabel: string;
  typeBehaviour: string;
  assignedToId: number;
  assignedToName: string;
  affectedDomainId: number;
  affectedDomainCode: string;
  affectedDomainName: string;
  affectedDomainColour: string;
  request: string;
  dueDate: string | null;
  statusId: number;
  statusLabel: string;
  statusBehaviour: string;
  response: string;
  resultingConsiderationId: string | null;
  dateClosed: string | null;
  reviewOutcome: ReviewOutcome | null;
  reviewOutcomeById: number | null;
  reviewOutcomeByName: string | null;
  reviewOutcomeAt: string | null;
  escalated: boolean;
  escalatedAt: string | null;
  escalatedByName: string | null;
  escalationReason: string | null;
  escalationResolvedAt: string | null;
  escalationResolvedByName: string | null;
  escalationResolution: string | null;
  iterationAuthorId: number;
  considerationOwnerId: number;
  createdAt: string;
  updatedAt: string;
  version: number;
  overdue: boolean;
}

export type ReviewOutcome = 'approved' | 'approved_with_comments' | 'changes_needed';
export const reviewOutcomes: Array<{ value: ReviewOutcome; label: string }> = [
  { value: 'approved', label: 'Approved' },
  { value: 'approved_with_comments', label: 'Approved with comments' },
  { value: 'changes_needed', label: 'Changes needed' },
];
export const reviewOutcomeLabel = (o: ReviewOutcome | null) => reviewOutcomes.find((x) => x.value === o)?.label ?? null;

export interface MyItems {
  assigned: Flag[];
  raised: Flag[];
  readyToClose: Iteration[];
  changesNeeded: Iteration[];
  escalated: Flag[];
}

export interface FeedItem {
  id: number;
  at: string;
  event: string;
  userId: number | null;
  userName: string | null;
  entityType: 'consideration' | 'iteration' | 'flag';
  entityId: string;
  domainId: number | null;
  domainCode: string | null;
  domainColour: string | null;
  considerationId: string | null;
  considerationTitle: string | null;
  from?: string | null;
  to?: string | null;
  text?: string;
  title?: string;
  ownerName?: string;
  subsystemName?: string;
  originFlagId?: string | null;
  verdictLabel?: string | null;
  verdictBehaviour?: string | null;
  statusLabel?: string;
  authorName?: string;
  typeLabel?: string;
  assignedToName?: string;
  affectedDomainCode?: string;
  affectedDomainColour?: string;
  dueDate?: string | null;
}

export interface ConsiderationDetail {
  consideration: Consideration;
  originFlag: Flag | null;
  iterations: Array<Iteration & { flags: Flag[] }>;
  spawned: Consideration[];
}

export interface Comment {
  id: number;
  authorId: number;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface Attachment {
  id: number;
  kind: 'file' | 'link';
  label: string;
  url: string | null;
  size: number | null;
  uploadedBy: number;
  uploadedByName: string;
  createdAt: string;
}

export interface HistoryRow {
  id: number;
  at: string;
  userName: string | null;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
}
