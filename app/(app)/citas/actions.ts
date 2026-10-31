"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { appointments } from "@/db/schema";
import { withTenant } from "@/lib/db/tenant";
import { overlapsBusy } from "@/lib/google/availability";
import { freeBusy, setEventStatus } from "@/lib/google/calendar";
import { errorMessage, log } from "@/lib/logger";
import type { AppointmentStatus } from "@/lib/panel/types";
import { requireSession } from "@/lib/session";

export type StatusResult = { ok: true; status: AppointmentStatus } | { ok: false; error: string; canForceLocal?: boolean };

const inputSchema = z.object({
  id: z.uuid(),
  status: z.enum(["confirmed", "cancelled", "completed"]),
  onlyPanel: z.boolean().optional(),
});

/** Transiciones válidas desde el panel. */
const TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  confirmed: ["cancelled", "completed"],
  cancelled: ["confirmed"],
  completed: ["confirmed"],
};

/**
 * Cambia el estado de una cita y lo sincroniza con Google Calendar: cancelar marca el evento como
 * cancelado; reactivar lo restaura (si el hueco sigue libre). «Completada» no toca el calendario.
 * Si Google falla, NO se cambia nada y se ofrece cambiar solo el panel (`onlyPanel`) de forma explícita.
 */
export async function updateAppointmentStatusAction(input: { id: string; status: AppointmentStatus; onlyPanel?: boolean }): Promise<StatusResult> {
  const { organizationId, organization } = await requireSession();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos no válidos" };
  const { id, status, onlyPanel } = parsed.data;

  const [appointment] = await withTenant(organizationId, (tx) => tx.select().from(appointments).where(eq(appointments.id, id)).limit(1));
  if (!appointment) return { ok: false, error: "No se encontró la cita" };
  const current: AppointmentStatus = appointment.status ?? "confirmed";
  if (current === status) return { ok: true, status };
  if (!TRANSITIONS[current].includes(status)) return { ok: false, error: "Ese cambio de estado no es posible" };

  const touchesCalendar = status === "cancelled" || (status === "confirmed" && current === "cancelled");
  if (touchesCalendar && appointment.googleEventId && !onlyPanel) {
    try {
      if (status === "confirmed") {
        const busy = await freeBusy(organizationId, appointment.startsAt, appointment.endsAt, organization.timezone);
        if (overlapsBusy(appointment.startsAt, appointment.endsAt, busy)) {
          return { ok: false, error: "Ese horario ya está ocupado en tu calendario: no se puede reactivar la cita." };
        }
      }
      await setEventStatus(organizationId, appointment.googleEventId, status === "cancelled" ? "cancelled" : "confirmed");
    } catch (error) {
      log.error("no se pudo sincronizar la cita con Google", { organizationId, appointmentId: id, status, error: errorMessage(error) });
      return { ok: false, error: `No se pudo sincronizar con Google Calendar (${errorMessage(error)}). La cita no se ha modificado.`, canForceLocal: true };
    }
  }

  await withTenant(organizationId, (tx) => tx.update(appointments).set({ status }).where(eq(appointments.id, id)));
  log.info("estado de cita cambiado desde el panel", { organizationId, appointmentId: id, from: current, to: status, onlyPanel: Boolean(onlyPanel) });
  return { ok: true, status };
}
