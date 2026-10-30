"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CaretLeft, CaretRight, CalendarBlank } from "@phosphor-icons/react";
import { AppointmentDialog, STATUS_META } from "@/components/appointments/appointment-dialog";
import { LiveIndicator } from "@/components/live-indicator";
import { Button } from "@/components/ui/button";
import {
  WEEKDAY_LABELS,
  civilKey,
  layoutDay,
  monthGrid,
  sameDay,
  shift,
  todayIn,
  visibleRange,
  weekDays,
  type CalendarView,
  type CivilDate,
} from "@/lib/panel/calendar-grid";
import { clock, dayKey, longDate, monthTitle } from "@/lib/panel/format";
import type { AppointmentDto, AppointmentStatus } from "@/lib/panel/types";
import { localParts, zonedTimeToUtc } from "@/lib/google/time";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { cn } from "@/lib/utils";

const HOUR_PX = 56;
const MONTH_CHIPS = 3;

const chipStyle: Record<AppointmentStatus, string> = {
  confirmed: "border-l-2 border-accent bg-accent-soft text-accent-ink",
  completed: "border-l-2 border-ink-4 bg-subtle text-ink-2",
  cancelled: "border-l-2 border-line-strong bg-canvas text-ink-4 line-through",
};

type Props = { initial: AppointmentDto[]; initialAnchor: CivilDate; timeZone: string };

export function AppointmentsCalendar({ initial, initialAnchor, timeZone }: Props) {
  const [view, setView] = useState<CalendarView>("month");
  const [anchor, setAnchor] = useState(initialAnchor);
  const [items, setItems] = useState(initial);
  const [showCancelled, setShowCancelled] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const request = useRef(0);
  const first = useRef(true);
  const today = useMemo(() => todayIn(timeZone), [timeZone]);

  const range = useMemo(() => visibleRange(view, anchor, timeZone), [view, anchor, timeZone]);
  const rangeKey = `${range.from.toISOString()}|${range.to.toISOString()}`;

  const load = useCallback(async () => {
    const id = ++request.current;
    const [from, to] = rangeKey.split("|");
    try {
      const response = await fetch(`/api/appointments?${new URLSearchParams({ from: from!, to: to! })}`, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { appointments: AppointmentDto[] };
      if (id === request.current) {
        setItems(data.appointments);
        setError(false);
      }
    } catch {
      if (id === request.current) setError(true);
    }
  }, [rangeKey]);

  // El primer render usa los datos del servidor; al navegar de rango se piden de nuevo.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void load();
  }, [load]);

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useRealtime((event) => {
    if (event.type !== "appointment.changed" && event.type !== "resync") return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(), 200);
  });
  useEffect(() => () => clearTimeout(timer.current), []);

  const visible = useMemo(() => (showCancelled ? items : items.filter((a) => a.status !== "cancelled")), [items, showCancelled]);
  const byDay = useMemo(() => {
    const map = new Map<string, AppointmentDto[]>();
    for (const a of visible) {
      const key = dayKey(a.startsAt, timeZone);
      map.set(key, [...(map.get(key) ?? []), a]);
    }
    return map;
  }, [visible, timeZone]);

  const selected = items.find((a) => a.id === selectedId) ?? null;
  const title = view === "month" ? monthTitle(zonedTimeToUtc(anchor.year, anchor.month, 15, 12, 0, timeZone), timeZone) : weekTitle(anchor, timeZone);
  const openDay = (day: CivilDate) => {
    setAnchor(day);
    setView("week");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="secondary" type="button" aria-label="Anterior" onClick={() => setAnchor(shift(view, anchor, -1))} className="w-9 px-0!">
            <CaretLeft size={18} weight="bold" />
          </Button>
          <Button variant="secondary" type="button" aria-label="Siguiente" onClick={() => setAnchor(shift(view, anchor, 1))} className="w-9 px-0!">
            <CaretRight size={18} weight="bold" />
          </Button>
          <Button variant="secondary" type="button" onClick={() => setAnchor(today)}>
            Hoy
          </Button>
          <h2 className="ml-2 text-base font-semibold first-letter:uppercase" aria-live="polite">
            {title}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
            Mostrar canceladas
          </label>
          <div role="tablist" aria-label="Vista" className="flex rounded-control border border-line-strong bg-surface p-0.5">
            {(["month", "week"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={cn("h-8 rounded-[0.375rem] px-3 text-sm font-medium", view === v ? "bg-accent-soft text-accent-ink" : "text-ink-3 hover:bg-subtle")}
              >
                {v === "month" ? "Mes" : "Semana"}
              </button>
            ))}
          </div>
          <LiveIndicator />
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
          No se pudieron cargar las citas. <button type="button" className="underline" onClick={() => void load()}>Reintentar</button>
        </p>
      ) : null}

      {view === "month" ? (
        <MonthView anchor={anchor} today={today} byDay={byDay} timeZone={timeZone} onSelect={setSelectedId} onOpenDay={openDay} />
      ) : (
        <WeekView anchor={anchor} today={today} byDay={byDay} timeZone={timeZone} onSelect={setSelectedId} />
      )}

      {items.length === 0 ? (
        <p className="flex items-center justify-center gap-2 text-sm text-ink-3">
          <CalendarBlank size={16} aria-hidden /> No hay citas en este periodo. Las que agende el asistente aparecerán aquí al instante.
        </p>
      ) : null}

      <AppointmentDialog
        appointment={selected}
        timeZone={timeZone}
        onClose={() => setSelectedId(null)}
        onStatusChanged={(id, status) => {
          setItems((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
          setSelectedId(null);
        }}
      />
    </div>
  );
}

function weekTitle(anchor: CivilDate, timeZone: string): string {
  const days = weekDays(anchor);
  const at = (d: CivilDate) => zonedTimeToUtc(d.year, d.month, d.day, 12, 0, timeZone);
  const fmt = (d: CivilDate, withYear: boolean) =>
    new Intl.DateTimeFormat("es", { timeZone, day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) }).format(at(d)).replace(".", "");
  return `${fmt(days[0]!, false)} – ${fmt(days[6]!, true)}`;
}

type ViewProps = {
  anchor: CivilDate;
  today: CivilDate;
  byDay: Map<string, AppointmentDto[]>;
  timeZone: string;
  onSelect: (id: string) => void;
};

function MonthView({ anchor, today, byDay, timeZone, onSelect, onOpenDay }: ViewProps & { onOpenDay: (d: CivilDate) => void }) {
  const weeks = monthGrid(anchor);
  return (
    <div className="overflow-hidden rounded-panel border border-line bg-surface">
      <div className="grid grid-cols-7 border-b border-line bg-canvas text-xs font-medium text-ink-3">
        {WEEKDAY_LABELS.map((d) => (
          <div key={d} className="px-2 py-2 text-center capitalize">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {weeks.flat().map((day) => {
          const key = civilKey(day);
          const list = byDay.get(key) ?? [];
          const inMonth = day.month === anchor.month;
          const isToday = sameDay(day, today);
          return (
            <div key={key} className={cn("min-h-16 border-r border-b border-line p-1 last:border-r-0 md:min-h-28 md:p-1.5", !inMonth && "bg-canvas")}>
              <button
                type="button"
                onClick={() => onOpenDay(day)}
                aria-label={`Ver semana del ${key}`}
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-xs font-medium hover:bg-subtle",
                  isToday ? "bg-accent text-white hover:bg-accent-hover" : inMonth ? "text-ink" : "text-ink-4",
                )}
              >
                {day.day}
              </button>
              {/* Móvil: solo un contador; escritorio: las primeras citas */}
              {list.length ? (
                <span className="mt-1 flex justify-center md:hidden">
                  <span className="rounded-full bg-accent-soft px-1.5 text-[11px] font-semibold text-accent-ink">{list.length}</span>
                </span>
              ) : null}
              <ul className="mt-1 hidden space-y-0.5 md:block">
                {list.slice(0, MONTH_CHIPS).map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(a.id)}
                      className={cn("w-full truncate rounded-[0.25rem] px-1.5 py-0.5 text-left text-xs", chipStyle[a.status])}
                      title={`${clock(a.startsAt, timeZone)} · ${a.fullName} · ${a.service}`}
                    >
                      <span className="font-semibold">{clock(a.startsAt, timeZone)}</span> {a.fullName}
                    </button>
                  </li>
                ))}
                {list.length > MONTH_CHIPS ? (
                  <li>
                    <button type="button" onClick={() => onOpenDay(day)} className="px-1.5 text-xs font-medium text-accent hover:underline">
                      +{list.length - MONTH_CHIPS} más
                    </button>
                  </li>
                ) : null}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type Slot = AppointmentDto & { startMin: number; endMin: number };

function toSlot(a: AppointmentDto, timeZone: string): Slot {
  const s = localParts(new Date(a.startsAt), timeZone);
  const startMin = s.hour * 60 + s.minute;
  const durationMin = Math.max(15, Math.round((new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 60_000));
  return { ...a, startMin, endMin: Math.min(startMin + durationMin, 24 * 60) };
}

function WeekView({ anchor, today, byDay, timeZone, onSelect }: ViewProps) {
  const days = weekDays(anchor);
  const slotsByDay = days.map((d) => (byDay.get(civilKey(d)) ?? []).map((a) => toSlot(a, timeZone)));
  const all = slotsByDay.flat();
  const startHour = Math.max(0, Math.min(8, ...all.map((s) => Math.floor(s.startMin / 60))));
  const endHour = Math.min(24, Math.max(19, ...all.map((s) => Math.ceil(s.endMin / 60))));
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const px = HOUR_PX / 60;
  const noon = (d: CivilDate) => zonedTimeToUtc(d.year, d.month, d.day, 12, 0, timeZone);

  return (
    <>
      {/* Escritorio: cuadrícula por horas */}
      <div className="hidden overflow-hidden rounded-panel border border-line bg-surface md:block">
        <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-line bg-canvas">
          <div />
          {days.map((d, i) => (
            <div key={civilKey(d)} className="px-2 py-2 text-center text-xs font-medium text-ink-3">
              <span className="capitalize">{WEEKDAY_LABELS[i]}</span>{" "}
              <span className={cn("ml-0.5 inline-flex size-6 items-center justify-center rounded-full text-sm", sameDay(d, today) ? "bg-accent text-white" : "text-ink")}>{d.day}</span>
            </div>
          ))}
        </div>
        <div className="grid max-h-[40rem] grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] overflow-y-auto">
          <div>
            {hours.map((h) => (
              <div key={h} style={{ height: HOUR_PX }} className="pr-2 text-right text-[11px] text-ink-4">
                <span className={cn("relative", h !== startHour && "-top-1.5")}>{String(h).padStart(2, "0")}:00</span>
              </div>
            ))}
          </div>
          {days.map((d, i) => {
            const positioned = layoutDay(slotsByDay[i]!, startHour * 60);
            return (
              <div key={civilKey(d)} className="relative border-l border-line" style={{ height: hours.length * HOUR_PX }}>
                {hours.map((h, row) => (
                  <div key={h} className="absolute inset-x-0 border-t border-line" style={{ top: row * HOUR_PX }} />
                ))}
                {positioned.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => onSelect(a.id)}
                    className={cn("absolute overflow-hidden rounded-[0.25rem] px-1.5 py-1 text-left text-xs leading-tight shadow-sm", chipStyle[a.status])}
                    style={{
                      top: a.top * px,
                      height: a.height * px - 2,
                      left: `calc(${(a.lane / a.lanes) * 100}% + 2px)`,
                      width: `calc(${100 / a.lanes}% - 4px)`,
                    }}
                    title={`${clock(a.startsAt, timeZone)} · ${a.fullName} · ${a.service}`}
                  >
                    <span className="font-semibold">{clock(a.startsAt, timeZone)}</span> {a.fullName}
                    <span className="block truncate capitalize opacity-80">{a.service}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Móvil: agenda por días */}
      <div className="space-y-4 md:hidden">
        {days.map((d, i) => {
          const list = slotsByDay[i]!;
          return (
            <section key={civilKey(d)}>
              <h3 className={cn("mb-1.5 text-sm font-semibold first-letter:uppercase", sameDay(d, today) && "text-accent")}>{longDate(noon(d), timeZone)}</h3>
              {list.length === 0 ? (
                <p className="rounded-panel border border-dashed border-line px-3 py-2 text-sm text-ink-4">Sin citas</p>
              ) : (
                <ul className="space-y-1.5">
                  {list.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(a.id)}
                        className={cn("flex w-full items-center justify-between gap-3 rounded-panel px-3 py-2 text-left text-sm", chipStyle[a.status])}
                      >
                        <span>
                          <span className="font-semibold">{clock(a.startsAt, timeZone)}</span> · {a.fullName}
                          <span className="block text-xs capitalize opacity-80">{a.service}</span>
                        </span>
                        <span className="text-xs">{STATUS_META[a.status].label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
