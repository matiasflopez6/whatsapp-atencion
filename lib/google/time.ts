import type { BusinessHours } from "@/db/types";

/** Aritmética de zonas horarias con Intl (sin dependencias). */
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: DayKey };

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function localParts(date: Date, timeZone: string): LocalParts {
  const map: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(date)) map[p.type] = p.value;
  const weekday = DAY_KEYS[["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(map.weekday ?? "")];
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    weekday: weekday ?? "sun",
  };
}

function offsetMs(utcMs: number, timeZone: string): number {
  const p = localParts(new Date(utcMs), timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0) - Math.floor(utcMs / 60_000) * 60_000;
}

/** Hora de pared en `timeZone` → instante UTC (resuelve el desfase real, también en cambios de hora). */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const first = guess - offsetMs(guess, timeZone);
  return new Date(guess - offsetMs(first, timeZone));
}

export function parseHHMM(value: string): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function dayRanges(hours: BusinessHours, weekday: DayKey): { start: number; end: number }[] {
  return (hours[weekday] ?? []).flatMap((r) => {
    const start = parseHHMM(r.start);
    const end = parseHHMM(r.end);
    return start !== null && end !== null && end > start ? [{ start, end }] : [];
  });
}

/** «martes 3 de noviembre, 10:30» en la zona del negocio (para mostrar al cliente). */
export function formatLocal(date: Date, timeZone: string): string {
  const text = new Intl.DateTimeFormat("es", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return text;
}
