import { z } from 'zod';
import { id, isoDate, required, text, version } from './validation.js';

const recordId = z.string().trim().toUpperCase().regex(/^[A-Z]{2,3}-C\d{2,}(-I\d{2,}(-F\d+)?)?$/, 'is not a valid ID');
const considerationIdS = recordId.refine((s) => /-C\d+$/.test(s), 'is not a consideration ID');
const iterationIdS = recordId.refine((s) => /-I\d+$/.test(s), 'is not an iteration ID');
const flagIdS = recordId.refine((s) => /-F\d+$/.test(s), 'is not a flag ID');
export const ids = { recordId, considerationId: considerationIdS, iterationId: iterationIdS, flagId: flagIdS };

// ---------- considerations ----------

const considerationFields = {
  subsystemId: id,
  title: required(200),
  targetMetric: text(2000),
  ownerId: id,
  statusId: id,
  notes: text(5000),
};

export const considerationCreate = z
  .object({
    domainId: id,
    subsystemId: id,
    title: required(200),
    targetMetric: text(2000).default(''),
    ownerId: id.optional(),
    originFlagId: flagIdS.nullish(),
    statusId: id.optional(),
    notes: text(5000).default(''),
  })
  .strict();
export type ConsiderationCreate = z.infer<typeof considerationCreate>;

export const considerationUpdate = z.object({ version, ...considerationFields }).partial().required({ version: true }).strict();
export type ConsiderationUpdate = z.infer<typeof considerationUpdate>;

/** "Create consideration from this flag": domain defaults to the flag's affected domain. */
export const considerationFromFlag = considerationCreate
  .omit({ originFlagId: true, domainId: true })
  .extend({ domainId: id.optional() })
  .strict();

// ---------- iterations ----------

const iterationFields = {
  date: isoDate,
  authorId: id,
  designInput: text(5000),
  cadDesign: text(500),
  analyticalResults: text(5000),
  simulationResults: text(5000),
  evidenceLink: text(1000),
  verdictId: id.nullable(),
  statusId: id,
  nextAction: text(2000),
};

export const iterationCreate = z
  .object({
    considerationId: considerationIdS,
    date: isoDate.optional(),
    authorId: id.optional(),
    designInput: text(5000).default(''),
    cadDesign: text(500).default(''),
    analyticalResults: text(5000).default(''),
    simulationResults: text(5000).default(''),
    evidenceLink: text(1000).default(''),
    verdictId: id.nullish(),
    statusId: id.optional(),
    nextAction: text(2000).default(''),
  })
  .strict();
export type IterationCreate = z.infer<typeof iterationCreate>;

export const iterationUpdate = z.object({ version, ...iterationFields }).partial().required({ version: true }).strict();
export type IterationUpdate = z.infer<typeof iterationUpdate>;

// ---------- flags ----------

export const flagCreate = z
  .object({
    iterationId: iterationIdS,
    typeId: id.optional(),
    assignedToId: id,
    affectedDomainId: id,
    request: required(5000),
    dueDate: isoDate.nullish(),
    dateRaised: isoDate.optional(),
  })
  .strict();
export type FlagCreate = z.infer<typeof flagCreate>;

export const flagUpdate = z
  .object({
    version,
    typeId: id,
    assignedToId: id,
    affectedDomainId: id,
    request: required(5000),
    dueDate: isoDate.nullable(),
    statusId: id,
    response: text(5000),
  })
  .partial()
  .required({ version: true })
  .strict();
export type FlagUpdate = z.infer<typeof flagUpdate>;

// ---------- combined entry ----------

export const entryCreate = z
  .object({
    consideration: considerationCreate.optional(),
    /** considerationId blank = the consideration created in this entry. */
    iteration: iterationCreate.extend({ considerationId: considerationIdS.optional() }).strict().optional(),
    /** iterationId blank = the iteration logged in this entry. */
    flags: z.array(flagCreate.extend({ iterationId: iterationIdS.optional() }).strict()).max(50).default([]),
  })
  .strict()
  .refine((e) => e.consideration || e.iteration || e.flags.length, 'Nothing to save');
export type EntryCreate = z.infer<typeof entryCreate>;
