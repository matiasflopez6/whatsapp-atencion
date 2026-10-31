/** Formato de fechas del panel, siempre en la zona horaria del negocio (no la del navegador). */
const LOCALE = "es";

const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(key: string, timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const id = `${key}|${timeZone}`;
  let f = cache.get(id);
  if (!f) cache.set(id, (f = new Intl.DateTimeFormat(LOCALE, { timeZone, ...options })));
  return f;
}

/** Clave yyyy-mm-dd del día local. */
export function dayKey(date: Date | string, timeZone: string): string {
  const parts = fmt("key", timeZone, { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(date));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export const clock = (date: Date | string, timeZone: string) =>
  fmt("clock", timeZone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(date));

const shortDate = (date: Date | string, timeZone: string) =>
  fmt("short", timeZone, { day: "numeric", month: "short" }).format(new Date(date)).replace(".", "");

export const longDate = (date: Date | string, timeZone: string) =>
  fmt("long", timeZone, { weekday: "long", day: "numeric", month: "long" }).format(new Date(date));

export const monthTitle = (date: Date | string, timeZone: string) =>
  fmt("month", timeZone, { month: "long", year: "numeric" }).format(new Date(date));

/** «Hoy», «Ayer» o «27 oct», para separadores de día. */
export function dayLabel(date: Date | string, timeZone: string, now: Date = new Date()): string {
  const key = dayKey(date, timeZone);
  if (key === dayKey(now, timeZone)) return "Hoy";
  if (key === dayKey(new Date(now.getTime() - 24 * 3600 * 1000), timeZone)) return "Ayer";
  return longDate(date, timeZone);
}

/** Hora si es de hoy, «Ayer» o fecha corta: para la lista de conversaciones. */
export function listTime(date: Date | string, timeZone: string, now: Date = new Date()): string {
  const key = dayKey(date, timeZone);
  if (key === dayKey(now, timeZone)) return clock(date, timeZone);
  if (key === dayKey(new Date(now.getTime() - 24 * 3600 * 1000), timeZone)) return "Ayer";
  return shortDate(date, timeZone);
}

export const dateTime = (date: Date | string, timeZone: string) => `${longDate(date, timeZone)}, ${clock(date, timeZone)}`;

export function initials(name: string | null, fallback: string): string {
  const source = (name ?? "").trim();
  if (!source) return fallback.replace(/\D/g, "").slice(-2) || "?";
  const parts = source.split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase();
}
