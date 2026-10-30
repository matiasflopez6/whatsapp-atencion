import { localParts, zonedTimeToUtc } from "@/lib/google/time";

/** Fecha de calendario sin hora ni zona (mes 1-12). La aritmética se hace en UTC para evitar desfases de DST. */
export type CivilDate = { year: number; month: number; day: number };
export type CalendarView = "month" | "week";

export const WEEKDAY_LABELS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"] as const;

const toUtc = (d: CivilDate) => Date.UTC(d.year, d.month - 1, d.day);
const fromUtc = (ms: number): CivilDate => {
  const date = new Date(ms);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
};

export const addDays = (d: CivilDate, days: number): CivilDate => fromUtc(toUtc(d) + days * 86_400_000);
export const addMonths = (d: CivilDate, months: number): CivilDate => {
  const total = d.year * 12 + (d.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { year, month, day: Math.min(d.day, lastDay) };
};
export const sameDay = (a: CivilDate, b: CivilDate) => a.year === b.year && a.month === b.month && a.day === b.day;

export const civilKey = (d: CivilDate) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

/** 0 = lunes … 6 = domingo. */
export const weekdayIndex = (d: CivilDate) => (new Date(toUtc(d)).getUTCDay() + 6) % 7;

export const startOfWeek = (d: CivilDate): CivilDate => addDays(d, -weekdayIndex(d));

export function todayIn(timeZone: string, now: Date = new Date()): CivilDate {
  const p = localParts(now, timeZone);
  return { year: p.year, month: p.month, day: p.day };
}

/** Semanas completas (lunes a domingo) que cubren el mes de `anchor`. */
export function monthGrid(anchor: CivilDate): CivilDate[][] {
  const first = { year: anchor.year, month: anchor.month, day: 1 };
  const start = startOfWeek(first);
  const lastDay = new Date(Date.UTC(anchor.year, anchor.month, 0)).getUTCDate();
  const weeks = Math.ceil((weekdayIndex(first) + lastDay) / 7);
  return Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
}

export const weekDays = (anchor: CivilDate): CivilDate[] => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i));

/** Intervalo [from, to) de instantes UTC que cubre la vista, a medianoche de la zona del negocio. */
export function visibleRange(view: CalendarView, anchor: CivilDate, timeZone: string): { from: Date; to: Date } {
  const days = view === "month" ? monthGrid(anchor).flat() : weekDays(anchor);
  const first = days[0]!;
  const after = addDays(days[days.length - 1]!, 1);
  return {
    from: zonedTimeToUtc(first.year, first.month, first.day, 0, 0, timeZone),
    to: zonedTimeToUtc(after.year, after.month, after.day, 0, 0, timeZone),
  };
}

export const shift = (view: CalendarView, anchor: CivilDate, direction: 1 | -1): CivilDate =>
  view === "month" ? addMonths({ ...anchor, day: 1 }, direction) : addDays(anchor, 7 * direction);

export type Positioned<T> = T & { top: number; height: number; lane: number; lanes: number };

/**
 * Coloca eventos de un día en columnas (lanes) para que los que se solapan se vean lado a lado.
 * Posiciones en minutos desde `gridStartMinute`.
 */
export function layoutDay<T extends { startMin: number; endMin: number }>(events: T[], gridStartMinute: number, minHeight = 28): Positioned<T>[] {
  const sorted = [...events].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const placed: Positioned<T>[] = [];
  let cluster: Positioned<T>[] = [];
  let clusterEnd = -1;
  const closeCluster = () => {
    const lanes = Math.max(1, ...cluster.map((e) => e.lane + 1));
    for (const e of cluster) e.lanes = lanes;
    placed.push(...cluster);
    cluster = [];
  };
  const laneEnds: number[] = [];
  for (const e of sorted) {
    if (cluster.length && e.startMin >= clusterEnd) {
      closeCluster();
      laneEnds.length = 0;
    }
    let lane = laneEnds.findIndex((end) => end <= e.startMin);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = e.endMin;
    cluster.push({ ...e, top: e.startMin - gridStartMinute, height: Math.max(e.endMin - e.startMin, minHeight), lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, e.endMin);
  }
  if (cluster.length) closeCluster();
  return placed;
}
