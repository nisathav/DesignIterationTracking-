// All calendar dates (iteration date, due date, ...) are 'YYYY-MM-DD' in the
// server's local time zone. Timestamps are ISO-8601 UTC.

let fixedNow: Date | null = null;

/** Tests can pin the clock. */
export function setNow(d: Date | null): void {
  fixedNow = d;
}

export function now(): Date {
  return fixedNow ? new Date(fixedNow) : new Date();
}

export function nowIso(): string {
  return now().toISOString();
}

export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function today(): string {
  return localDate(now());
}
