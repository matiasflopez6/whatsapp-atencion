import { and, asc, gte, lt, sql } from "drizzle-orm";
import { appointments } from "@/db/schema";
import { withTenant } from "@/lib/db/tenant";
import type { AppointmentDto } from "./types";

/** Citas cuyo inicio cae en [from, to). Incluye canceladas y completadas: el calendario las muestra atenuadas. */
export async function listAppointments(organizationId: string, from: Date, to: Date): Promise<AppointmentDto[]> {
  const rows = await withTenant(organizationId, (tx) =>
    tx
      .select({
        id: appointments.id,
        service: appointments.service,
        startsAt: appointments.startsAt,
        endsAt: appointments.endsAt,
        status: appointments.status,
        fullName: appointments.fullName,
        phone: appointments.phone,
        notes: appointments.notes,
        isNewPatient: appointments.isNewPatient,
        googleEventId: appointments.googleEventId,
        conversationId: sql<string | null>`(select c.id from conversations c where c.contact_id = ${appointments.contactId} limit 1)`,
      })
      .from(appointments)
      .where(and(gte(appointments.startsAt, from), lt(appointments.startsAt, to)))
      .orderBy(asc(appointments.startsAt)),
  );
  return rows.map(({ googleEventId, status, ...row }) => ({
    ...row,
    status: status ?? "confirmed",
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    hasGoogleEvent: Boolean(googleEventId),
  }));
}

