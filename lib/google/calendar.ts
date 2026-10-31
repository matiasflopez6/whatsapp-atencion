import { eq } from "drizzle-orm";
import { googleCalendarConfigs } from "@/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";
import { withTenant } from "@/lib/db/tenant";
import { errorMessage, log } from "@/lib/logger";
import type { Interval } from "./availability";
import { GoogleAuthError, refreshAccessToken } from "./oauth";

const API = "https://www.googleapis.com/calendar/v3";

type CalendarConfig = { calendarId: string; accessToken: string };

async function loadConfig(organizationId: string) {
  const [row] = await withTenant(organizationId, (tx) =>
    tx.select().from(googleCalendarConfigs).where(eq(googleCalendarConfigs.organizationId, organizationId)).limit(1),
  );
  return row ?? null;
}

async function markDisconnected(organizationId: string, reason: string): Promise<void> {
  await withTenant(organizationId, (tx) =>
    tx
      .update(googleCalendarConfigs)
      .set({ status: "disconnected", lastError: reason, updatedAt: new Date() })
      .where(eq(googleCalendarConfigs.organizationId, organizationId)),
  );
}

/**
 * Access token vigente (lo refresca con el refresh token cifrado). Si Google responde `invalid_grant`
 * la integración queda «desconectada» (visible en /integraciones) y se lanza GoogleAuthError.
 */
export async function getCalendarConfig(organizationId: string): Promise<CalendarConfig> {
  const row = await loadConfig(organizationId);
  if (!row) throw new GoogleAuthError("Google Calendar no está conectado");
  if (row.status === "disconnected") throw new GoogleAuthError(row.lastError ?? undefined);

  if (row.accessTokenEncrypted && row.tokenExpiresAt && row.tokenExpiresAt.getTime() > Date.now() + 60_000) {
    return { calendarId: row.calendarId, accessToken: decrypt(row.accessTokenEncrypted) };
  }
  try {
    const tokens = await refreshAccessToken(decrypt(row.refreshTokenEncrypted));
    await withTenant(organizationId, (tx) =>
      tx
        .update(googleCalendarConfigs)
        .set({
          accessTokenEncrypted: encrypt(tokens.accessToken),
          tokenExpiresAt: tokens.expiresAt,
          // Google puede rotar el refresh token; si no lo hace, se conserva el actual.
          ...(tokens.refreshToken ? { refreshTokenEncrypted: encrypt(tokens.refreshToken) } : {}),
          updatedAt: new Date(),
        })
        .where(eq(googleCalendarConfigs.organizationId, organizationId)),
    );
    return { calendarId: row.calendarId, accessToken: tokens.accessToken };
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      log.warn("google calendar desconectado (invalid_grant)", { organizationId });
      await markDisconnected(organizationId, "Google revocó o caducó el acceso. Vuelve a conectar tu calendario.");
    }
    throw error;
  }
}

/** Error HTTP de la API de Google Calendar (conserva el estado para distinguir 404/410: evento ya borrado). */
export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

async function api<T>(accessToken: string, path: string, init?: { method: string; body?: unknown }): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 204) return undefined as T;
  const json = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok) throw new GoogleApiError(`Google Calendar ${response.status}: ${json.error?.message ?? "error"}`, response.status);
  return json;
}

export async function freeBusy(organizationId: string, from: Date, to: Date, timeZone: string): Promise<Interval[]> {
  const { calendarId, accessToken } = await getCalendarConfig(organizationId);
  const result = await api<{ calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }> }>(
    accessToken,
    "/freeBusy",
    { method: "POST", body: { timeMin: from.toISOString(), timeMax: to.toISOString(), timeZone, items: [{ id: calendarId }] } },
  );
  const calendar = result.calendars?.[calendarId];
  // Sin datos del calendario NO se asume que esté libre.
  if (!calendar || calendar.errors?.length) throw new Error("Google no devolvió la disponibilidad del calendario");
  return (calendar.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
}

export type NewEvent = { summary: string; description: string; start: Date; end: Date; timeZone: string };

export async function insertEvent(organizationId: string, event: NewEvent): Promise<{ id: string }> {
  const { calendarId, accessToken } = await getCalendarConfig(organizationId);
  const created = await api<{ id: string }>(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    body: {
      summary: event.summary,
      description: event.description,
      start: { dateTime: event.start.toISOString(), timeZone: event.timeZone },
      end: { dateTime: event.end.toISOString(), timeZone: event.timeZone },
    },
  });
  return { id: created.id };
}

/**
 * Cancela o restaura un evento sin borrarlo (`status` del evento): la cita cancelada desde el panel
 * desaparece del calendario pero puede reactivarse. Si el evento ya no existe (404/410) en una
 * cancelación se da por hecho; al restaurar sí es un error.
 */
export async function setEventStatus(organizationId: string, eventId: string, status: "confirmed" | "cancelled"): Promise<void> {
  const { calendarId, accessToken } = await getCalendarConfig(organizationId);
  try {
    await api(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      body: { status },
    });
  } catch (error) {
    if (status === "cancelled" && error instanceof GoogleApiError && (error.status === 404 || error.status === 410)) return;
    throw error;
  }
}

/** Compensación si falla el guardado posterior en base de datos. Nunca lanza. */
export async function deleteEvent(organizationId: string, eventId: string): Promise<void> {
  try {
    const { calendarId, accessToken } = await getCalendarConfig(organizationId);
    await api(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
  } catch (error) {
    log.error("no se pudo borrar el evento de Google", { organizationId, eventId, error: errorMessage(error) });
  }
}

export type CalendarSummary = { id: string; name: string; primary: boolean };

export async function listCalendars(organizationId: string): Promise<CalendarSummary[]> {
  const { accessToken } = await getCalendarConfig(organizationId);
  const result = await api<{ items?: { id: string; summary?: string; primary?: boolean }[] }>(
    accessToken,
    "/users/me/calendarList?minAccessRole=writer",
  );
  return (result.items ?? []).map((c) => ({ id: c.id, name: c.summary ?? c.id, primary: Boolean(c.primary) }));
}

/** Tras el OAuth aún no hay config: pide el calendario principal con un access token recién obtenido. */
export async function fetchPrimaryCalendar(accessToken: string): Promise<{ id: string; name: string }> {
  const primary = await api<{ id: string; summary?: string }>(accessToken, "/users/me/calendarList/primary");
  return { id: primary.id, name: primary.summary ?? primary.id };
}
