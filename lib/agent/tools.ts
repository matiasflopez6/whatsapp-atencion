import { tool } from "ai";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { appointments, contacts, conversations } from "@/db/schema";
import type { AgentConfig } from "@/db/types";
import { withTenant } from "@/lib/db/tenant";
import { computeSlots, overlapsBusy, pickSlots, withinBusinessHours, type Interval } from "@/lib/google/availability";
import * as googleCalendar from "@/lib/google/calendar";
import { GoogleAuthError, GoogleNotConfiguredError } from "@/lib/google/oauth";
import { formatLocal, localParts, zonedTimeToUtc } from "@/lib/google/time";
import { errorMessage, log } from "@/lib/logger";
import { withLock } from "@/lib/mutex";

/** Lo único que el agente necesita de Google Calendar: se sustituye en los tests. */
export type CalendarPort = {
  freeBusy: (organizationId: string, from: Date, to: Date, timeZone: string) => Promise<Interval[]>;
  insertEvent: (organizationId: string, event: googleCalendar.NewEvent) => Promise<{ id: string }>;
  deleteEvent: (organizationId: string, eventId: string) => Promise<void>;
};

export const realCalendar: CalendarPort = {
  freeBusy: googleCalendar.freeBusy,
  insertEvent: googleCalendar.insertEvent,
  deleteEvent: googleCalendar.deleteEvent,
};

/** Efectos del turno que el procesador necesita conocer (no se pueden descartar respuestas con efectos). */
export type AgentOutcome = { handoff: boolean; handoffReason?: string; booked: boolean };

export type AgentToolContext = {
  organizationId: string;
  organizationName: string;
  conversationId: string;
  contact: { id: string; waPhone: string; fullName: string | null };
  config: AgentConfig;
  timeZone: string;
  now: () => Date;
  calendar: CalendarPort;
  /** Lo rellena handoff_to_human; run.ts lo lee al terminar. */
  outcome: AgentOutcome;
};

const DEFAULT_DURATION_MINUTES = 30;
const SEARCH_DAYS = 14;
const MAX_SEARCH_DAYS = 21;

function findService(config: AgentConfig, name: string) {
  const wanted = name.trim().toLowerCase();
  return (
    config.services.find((s) => s.name.toLowerCase() === wanted) ??
    config.services.find((s) => s.name.toLowerCase().includes(wanted) || wanted.includes(s.name.toLowerCase()))
  );
}

function durationFor(config: AgentConfig, serviceName: string): { name: string; minutes: number } | null {
  if (!config.services.length) return { name: serviceName.trim(), minutes: DEFAULT_DURATION_MINUTES };
  const service = findService(config, serviceName);
  return service ? { name: service.name, minutes: service.duration_minutes } : null;
}

function unknownService(config: AgentConfig) {
  return { error: "unknown_service", valid_services: config.services.map((s) => s.name) };
}

/** Un fallo de calendario nunca se convierte en disponibilidad inventada. */
function calendarFailure(ctx: AgentToolContext, error: unknown) {
  const known = error instanceof GoogleAuthError || error instanceof GoogleNotConfiguredError;
  log.error("fallo de Google Calendar en el agente", { organizationId: ctx.organizationId, known, error: errorMessage(error) });
  return {
    error: "calendar_unavailable",
    instruction: "No ofrezcas horarios ni confirmes citas. Explica que no puedes consultar la agenda ahora y ofrece pasar con una persona.",
  };
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD");

export function createAgentTools(ctx: AgentToolContext) {
  const label = (d: Date) => formatLocal(d, ctx.timeZone);

  return {
    check_availability: tool({
      description:
        "Consulta los horarios LIBRES reales del calendario del negocio para un servicio y devuelve hasta 3 opciones. Es la única fuente válida de horarios.",
      inputSchema: z.object({
        service: z.string().describe("Nombre del servicio o motivo, como figura en la lista de servicios"),
        date_from: isoDate.optional().describe("Primer día a buscar (YYYY-MM-DD, hora local del negocio). Por defecto hoy."),
        date_to: isoDate.optional().describe("Último día a buscar, inclusive. Por defecto 14 días desde date_from."),
        part_of_day: z.enum(["morning", "afternoon", "any"]).default("any").describe("morning = antes de las 13:00, afternoon = desde las 13:00"),
      }),
      execute: async ({ service, date_from, date_to, part_of_day }) => {
        const resolved = durationFor(ctx.config, service);
        if (!resolved) return unknownService(ctx.config);

        const now = ctx.now();
        const today = localParts(now, ctx.timeZone);
        const [fy, fm, fd] = date_from ? date_from.split("-").map(Number) : [today.year, today.month, today.day];
        const from = zonedTimeToUtc(fy!, fm!, fd!, 0, 0, ctx.timeZone);
        let to: Date;
        if (date_to) {
          const [ty, tm, td] = date_to.split("-").map(Number);
          to = zonedTimeToUtc(ty!, tm!, td! + 1, 0, 0, ctx.timeZone);
        } else {
          to = zonedTimeToUtc(fy!, fm!, fd! + SEARCH_DAYS, 0, 0, ctx.timeZone);
        }
        const maxTo = zonedTimeToUtc(fy!, fm!, fd! + MAX_SEARCH_DAYS, 0, 0, ctx.timeZone);
        if (to > maxTo) to = maxTo;
        if (to <= from) return { error: "invalid_range", instruction: "date_to debe ser igual o posterior a date_from" };

        try {
          const busy = await ctx.calendar.freeBusy(ctx.organizationId, from, to, ctx.timeZone);
          let slots = computeSlots({
            businessHours: ctx.config.businessHours,
            busy,
            durationMinutes: resolved.minutes,
            timeZone: ctx.timeZone,
            from,
            to,
            now,
          });
          if (part_of_day !== "any") {
            slots = slots.filter((s) => {
              const hour = localParts(s.start, ctx.timeZone).hour;
              return part_of_day === "morning" ? hour < 13 : hour >= 13;
            });
          }
          const picked = pickSlots(slots, 3, ctx.timeZone);
          if (!picked.length) {
            return { slots: [], message: "No hay horarios libres en ese rango. Prueba con otro día o franja, o pasa con una persona." };
          }
          return {
            service: resolved.name,
            duration_minutes: resolved.minutes,
            timezone: ctx.timeZone,
            slots: picked.map((s) => ({ start_iso: s.start.toISOString(), label: label(s.start) })),
          };
        } catch (error) {
          return calendarFailure(ctx, error);
        }
      },
    }),

    book_appointment: tool({
      description:
        "Agenda la cita en Google Calendar y en el panel. Solo con un start_iso devuelto por check_availability y con todos los datos del cliente confirmados.",
      inputSchema: z.object({
        service: z.string(),
        start_iso: z.string().describe("start_iso exacto de uno de los horarios devueltos por check_availability"),
        full_name: z.string().min(2).describe("Nombre completo del cliente"),
        is_new_patient: z.boolean().describe("true si es cliente nuevo / primera visita"),
        phone: z.string().optional().describe("Solo si el cliente da un teléfono distinto al de WhatsApp"),
        notes: z.string().optional().describe("Motivo o detalles relevantes"),
      }),
      // Una reserva a la vez por organización: evita que dos clientes tomen el mismo hueco.
      execute: (input) => withLock(`booking:${ctx.organizationId}`, () => book(ctx, input)),
    }),

    get_business_info: tool({
      description:
        "Devuelve la información del negocio configurada por el dueño: dirección, precios, políticas, preguntas frecuentes, servicios y horarios. Úsala antes de responder cualquier dato del negocio que no tengas.",
      inputSchema: z.object({ topic: z.string().optional().describe("Tema que buscas (solo informativo)") }),
      execute: async () => ({
        name: ctx.organizationName,
        timezone: ctx.timeZone,
        services: ctx.config.services,
        business_hours: ctx.config.businessHours,
        info: ctx.config.businessInfo,
      }),
    }),

    handoff_to_human: tool({
      description:
        "Desactiva el bot en esta conversación y avisa al equipo para que una persona continúe. Úsalo si el cliente lo pide, hay una urgencia o no puedes resolver la duda.",
      inputSchema: z.object({ reason: z.string().describe("Motivo breve del traspaso, para el equipo") }),
      execute: async ({ reason }) => {
        await withTenant(ctx.organizationId, (tx) =>
          tx
            .update(conversations)
            .set({ botActive: false, handoffReason: reason.slice(0, 500) })
            .where(eq(conversations.id, ctx.conversationId)),
        );
        ctx.outcome.handoff = true;
        ctx.outcome.handoffReason = reason;
        log.info("handoff a humano", { organizationId: ctx.organizationId, conversationId: ctx.conversationId });
        return { handed_off: true };
      },
    }),
  };
}

type BookInput = {
  service: string;
  start_iso: string;
  full_name: string;
  is_new_patient: boolean;
  phone?: string;
  notes?: string;
};

async function book(ctx: AgentToolContext, input: BookInput) {
  const resolved = durationFor(ctx.config, input.service);
  if (!resolved) return unknownService(ctx.config);

  const start = new Date(input.start_iso);
  if (Number.isNaN(start.getTime()) || start <= ctx.now()) {
    return { confirmed: false, error: "invalid_start", instruction: "Usa un start_iso futuro devuelto por check_availability." };
  }
  const end = new Date(start.getTime() + resolved.minutes * 60_000);
  if (!withinBusinessHours(start, end, ctx.config.businessHours, ctx.timeZone)) {
    return { confirmed: false, error: "outside_business_hours", instruction: "Vuelve a llamar a check_availability y ofrece uno de sus horarios." };
  }

  // Idempotencia: un reintento de la misma reserva no crea otra cita.
  const [existing] = await withTenant(ctx.organizationId, (tx) =>
    tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(and(eq(appointments.contactId, ctx.contact.id), eq(appointments.startsAt, start), eq(appointments.status, "confirmed")))
      .limit(1),
  );
  if (existing) {
    ctx.outcome.booked = true;
    return { confirmed: true, already_booked: true, service: resolved.name, when: formatLocal(start, ctx.timeZone) };
  }

  let eventId: string;
  try {
    const busy = await ctx.calendar.freeBusy(ctx.organizationId, start, end, ctx.timeZone);
    if (overlapsBusy(start, end, busy)) {
      return { confirmed: false, error: "slot_taken", instruction: "Ese horario ya no está libre. Llama a check_availability y ofrece otras opciones." };
    }
    const phone = input.phone?.trim() || ctx.contact.waPhone;
    const event = await ctx.calendar.insertEvent(ctx.organizationId, {
      summary: `${resolved.name} — ${input.full_name}`,
      description: [
        `Cliente: ${input.full_name}`,
        `Teléfono: ${phone}`,
        `Cliente nuevo: ${input.is_new_patient ? "sí" : "no"}`,
        input.notes ? `Notas: ${input.notes}` : null,
        `Agendada por el asistente de WhatsApp de ${ctx.organizationName}.`,
      ]
        .filter(Boolean)
        .join("\n"),
      start,
      end,
      timeZone: ctx.timeZone,
    });
    eventId = event.id;
  } catch (error) {
    return { confirmed: false, ...calendarFailure(ctx, error) };
  }

  try {
    await withTenant(ctx.organizationId, async (tx) => {
      await tx.insert(appointments).values({
        organizationId: ctx.organizationId,
        contactId: ctx.contact.id,
        service: resolved.name,
        startsAt: start,
        endsAt: end,
        googleEventId: eventId,
        status: "confirmed",
        isNewPatient: input.is_new_patient,
        fullName: input.full_name,
        phone: input.phone?.trim() || ctx.contact.waPhone,
        notes: input.notes ?? null,
      });
      await tx.update(contacts).set({ fullName: input.full_name, isNewPatient: input.is_new_patient }).where(eq(contacts.id, ctx.contact.id));
    });
  } catch (error) {
    // El evento existe en Google pero no en el panel: se deshace para no dejar citas fantasma.
    log.error("no se pudo guardar la cita; se borra el evento de Google", { organizationId: ctx.organizationId, error: errorMessage(error) });
    await ctx.calendar.deleteEvent(ctx.organizationId, eventId);
    return { confirmed: false, error: "save_failed", instruction: "No se pudo guardar la cita. No la confirmes; ofrece pasar con una persona." };
  }

  ctx.outcome.booked = true;
  log.info("cita agendada", { organizationId: ctx.organizationId, conversationId: ctx.conversationId, googleEventId: eventId });
  return { confirmed: true, service: resolved.name, when: formatLocal(start, ctx.timeZone), duration_minutes: resolved.minutes };
}
