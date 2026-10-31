import type { BusinessHours } from "@/db/types";
import { dayRanges, localParts, zonedTimeToUtc } from "./time";

export type Interval = { start: Date; end: Date };

export type SlotQuery = {
  businessHours: BusinessHours;
  busy: Interval[];
  durationMinutes: number;
  timeZone: string;
  /** Rango de búsqueda: inicio inclusivo, fin exclusivo (se miran los inicios de slot). */
  from: Date;
  to: Date;
  now: Date;
  minNoticeMinutes?: number;
  stepMinutes?: number;
};

const MINUTE = 60_000;

export function overlapsBusy(start: Date, end: Date, busy: Interval[]): boolean {
  return busy.some((b) => start < b.end && end > b.start);
}

/** ¿El intervalo cabe entero dentro de un tramo de horario del mismo día local? */
export function withinBusinessHours(start: Date, end: Date, hours: BusinessHours, timeZone: string): boolean {
  const s = localParts(start, timeZone);
  const e = localParts(end, timeZone);
  if (s.year !== e.year || s.month !== e.month || s.day !== e.day) return false;
  const startMin = s.hour * 60 + s.minute;
  const endMin = e.hour * 60 + e.minute;
  return dayRanges(hours, s.weekday).some((r) => startMin >= r.start && endMin <= r.end);
}

/** Todos los inicios posibles (rejilla de `stepMinutes`) que caben en horario y no chocan con `busy`. */
export function computeSlots(query: SlotQuery): Interval[] {
  const { businessHours, busy, durationMinutes, timeZone, from, to, now } = query;
  const step = query.stepMinutes ?? 30;
  const earliest = new Date(Math.max(from.getTime(), now.getTime() + (query.minNoticeMinutes ?? 60) * MINUTE));
  const slots: Interval[] = [];

  const first = localParts(from, timeZone);
  const days = Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * MINUTE)) + 2;
  for (let i = 0; i < days; i++) {
    // Mediodía UTC del día i evita saltos por cambios de hora al calcular la fecha local.
    const noon = new Date(Date.UTC(first.year, first.month - 1, first.day + i, 12));
    const y = noon.getUTCFullYear();
    const mo = noon.getUTCMonth() + 1;
    const d = noon.getUTCDate();
    const weekday = localParts(zonedTimeToUtc(y, mo, d, 12, 0, timeZone), timeZone).weekday;
    for (const range of dayRanges(businessHours, weekday)) {
      for (let m = range.start; m + durationMinutes <= range.end; m += step) {
        const start = zonedTimeToUtc(y, mo, d, Math.floor(m / 60), m % 60, timeZone);
        const end = new Date(start.getTime() + durationMinutes * MINUTE);
        if (start < earliest || start >= to) continue;
        if (!overlapsBusy(start, end, busy)) slots.push({ start, end });
      }
    }
  }
  return slots.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Elige hasta `count` slots repartidos (otro día o ≥ 2 h de distancia); completa con los más tempranos. */
export function pickSlots(slots: Interval[], count = 3, timeZone = "UTC"): Interval[] {
  const picked: Interval[] = [];
  const dayOf = (d: Date) => {
    const p = localParts(d, timeZone);
    return `${p.year}-${p.month}-${p.day}`;
  };
  for (const slot of slots) {
    if (picked.length >= count) break;
    const last = picked[picked.length - 1];
    if (!last || dayOf(slot.start) !== dayOf(last.start) || slot.start.getTime() - last.start.getTime() >= 120 * MINUTE) {
      picked.push(slot);
    }
  }
  for (const slot of slots) {
    if (picked.length >= count) break;
    if (!picked.includes(slot)) picked.push(slot);
  }
  return picked.sort((a, b) => a.start.getTime() - b.start.getTime());
}
