import { z } from 'zod';
import { badRequest } from './errors.js';

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const issues = r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw badRequest(issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; '), issues);
  }
  return r.data;
}

export const id = z.coerce.number().int().positive();

/** Trimmed free text, empty allowed. */
export const text = (max: number) => z.string().trim().max(max);
/** Trimmed free text, at least one character. */
export const required = (max: number) => z.string().trim().min(1, 'is required').max(max);

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'is not a valid date');

export const colour = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'must be a colour like #DDEBF7').transform((s) => s.toUpperCase());

export const version = z.number().int().positive();

export const entityType = z.enum(['consideration', 'iteration', 'flag']);

/** Query-string boolean: '1' / 'true'. */
export const flag = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => v === true || v === '1' || v === 'true');

/** Comma-separated list in a query string, or a repeated parameter. */
export const idList = z
  .union([z.string(), z.array(z.string()), z.number()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === '') return undefined;
    const arr = Array.isArray(v) ? v : String(v).split(',');
    const nums = arr.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
    return nums.length ? nums : undefined;
  });

export const strList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => {
    if (v === undefined || v === '') return undefined;
    const arr = (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim()).filter(Boolean);
    return arr.length ? arr : undefined;
  });
