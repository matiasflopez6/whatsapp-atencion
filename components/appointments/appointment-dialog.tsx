"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CalendarCheck, ChatCircleText, Phone, WarningCircle, X } from "@phosphor-icons/react";
import { updateAppointmentStatusAction } from "@/app/(app)/citas/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { clock, dateTime } from "@/lib/panel/format";
import type { AppointmentDto, AppointmentStatus } from "@/lib/panel/types";

export const STATUS_META: Record<AppointmentStatus, { label: string; tone: "accent" | "neutral" | "danger" }> = {
  confirmed: { label: "Confirmada", tone: "accent" },
  completed: { label: "Completada", tone: "neutral" },
  cancelled: { label: "Cancelada", tone: "danger" },
};

type Props = {
  appointment: AppointmentDto | null;
  timeZone: string;
  onClose: () => void;
  onStatusChanged: (id: string, status: AppointmentStatus) => void;
};

export function AppointmentDialog({ appointment, timeZone, onClose, onStatusChanged }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState<AppointmentStatus | null>(null);
  const [error, setError] = useState<{ message: string; canForceLocal: boolean; target: AppointmentStatus } | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (appointment && !dialog.open) dialog.showModal();
    if (!appointment && dialog.open) dialog.close();
    setError(null);
  }, [appointment?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = async (status: AppointmentStatus, onlyPanel = false) => {
    if (!appointment) return;
    setPending(status);
    setError(null);
    const result = await updateAppointmentStatusAction({ id: appointment.id, status, onlyPanel });
    setPending(null);
    if (result.ok) return onStatusChanged(appointment.id, result.status);
    setError({ message: result.error, canForceLocal: Boolean(result.canForceLocal), target: status });
  };

  const a = appointment;
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // clic en el fondo
      }}
      aria-labelledby="appointment-title"
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-panel border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/30"
    >
      {a ? (
        <div className="space-y-5 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="appointment-title" className="text-base font-semibold capitalize">
                {a.service}
              </h2>
              <p className="mt-0.5 text-sm text-ink-3">
                {dateTime(a.startsAt, timeZone)} – {clock(a.endsAt, timeZone)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={STATUS_META[a.status].tone}>{STATUS_META[a.status].label}</Badge>
              <button type="button" onClick={onClose} aria-label="Cerrar" className="flex size-8 items-center justify-center rounded-control hover:bg-subtle">
                <X size={16} />
              </button>
            </div>
          </div>

          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2.5 text-sm">
            <dt className="text-ink-3">Cliente</dt>
            <dd className="font-medium">{a.fullName}</dd>
            <dt className="text-ink-3">Teléfono</dt>
            <dd className="flex items-center gap-1.5">
              <Phone size={14} className="text-ink-3" aria-hidden /> {a.phone}
            </dd>
            <dt className="text-ink-3">Cliente nuevo</dt>
            <dd>{a.isNewPatient === null ? "—" : a.isNewPatient ? "Sí" : "No"}</dd>
            <dt className="text-ink-3">Notas</dt>
            <dd className="whitespace-pre-wrap">{a.notes || "—"}</dd>
            <dt className="text-ink-3">Google Calendar</dt>
            <dd className="flex items-center gap-1.5">
              <CalendarCheck size={14} className="text-ink-3" aria-hidden />
              {a.hasGoogleEvent ? "Sincronizada" : "Sin evento en Google"}
            </dd>
          </dl>

          {a.conversationId ? (
            <Link href={`/conversaciones/${a.conversationId}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
              <ChatCircleText size={16} aria-hidden /> Ver conversación
            </Link>
          ) : null}

          {error ? (
            <div role="alert" className="space-y-2 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
              <p className="flex items-start gap-2">
                <WarningCircle size={16} className="mt-0.5 shrink-0" aria-hidden /> {error.message}
              </p>
              {error.canForceLocal ? (
                <Button variant="secondary" type="button" className="h-8 text-xs" disabled={pending !== null} onClick={() => change(error.target, true)}>
                  Cambiar solo en el panel (sin tocar Google)
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
            {a.status === "confirmed" ? (
              <>
                <Button variant="danger" type="button" disabled={pending !== null} onClick={() => change("cancelled")}>
                  {pending === "cancelled" ? "Cancelando…" : "Cancelar cita"}
                </Button>
                <Button type="button" disabled={pending !== null} onClick={() => change("completed")}>
                  {pending === "completed" ? "Guardando…" : "Marcar como completada"}
                </Button>
              </>
            ) : (
              <Button variant="secondary" type="button" disabled={pending !== null} onClick={() => change("confirmed")}>
                {pending === "confirmed" ? "Guardando…" : a.status === "cancelled" ? "Reactivar cita" : "Volver a confirmada"}
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
