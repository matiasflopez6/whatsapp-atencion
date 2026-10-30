import { and, eq, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db } from "./index";
import { agentConfigs, organizations, profiles, whatsappConfigs } from "@/db/schema";
import type { Organization, Profile } from "@/db/types";

/**
 * OPERACIONES DE SISTEMA: corren con el usuario dueño (sin RLS) y por eso son las únicas fuera de
 * withTenant(). Mantenerlas mínimas y documentadas. Autorizadas:
 *   1. Healthcheck.
 *   2. Resolver la organización de un usuario autenticado (profiles) y crearla en el signup.
 *   3. Resolver la organización a partir de `phone_number_id` en el webhook.
 *   4. Cron de reproceso: reclamar webhook_events pendientes/atascados antes de entrar a withTenant().
 *   5. Webhook de WhatsApp: verificar `hub.verify_token` (GET) y leer el App Secret del número para
 *      validar la firma (POST) ANTES de saber a qué organización pertenece la petición.
 */

export async function pingDatabase(): Promise<void> {
  await db.execute(sql`select 1`);
}

// ── 2. Organización del usuario ────────────────────────────────────────────────────────────────

export type UserOrganization = { profile: Profile; organization: Organization };

export async function getUserOrganization(userId: string): Promise<UserOrganization | null> {
  const [row] = await db
    .select({ profile: profiles, organization: organizations })
    .from(profiles)
    .innerJoin(organizations, eq(organizations.id, profiles.organizationId))
    .where(eq(profiles.userId, userId))
    .limit(1);
  return row ?? null;
}

export const DEFAULT_SYSTEM_PROMPT = `Eres el asistente virtual de atención al cliente de {{negocio}}. Atiendes por WhatsApp.

Tus objetivos:
- Resolver dudas usando únicamente la información del negocio que se te proporciona.
- Ayudar a agendar citas: pregunta el motivo, propón horarios libres reales y recoge los datos necesarios.
- Si no sabes algo, o el cliente pide hablar con una persona, pasa la conversación a un humano.

Reglas:
- Nunca inventes horarios, precios, servicios ni políticas.
- Responde en mensajes breves y claros, en el idioma del cliente.`;

function slugify(input: string): string {
  const base = input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "negocio";
}

/**
 * Crea organización + agent_configs por defecto + profile en UNA transacción (signup). Idempotente:
 * si el usuario ya tiene perfil, lo devuelve. Lo llama el hook `user.create.after` de Better Auth y,
 * como red de seguridad, getSession() cuando falta el perfil.
 */
export async function ensureOrganizationForUser(input: {
  userId: string;
  fullName: string;
  organizationName?: string;
}): Promise<UserOrganization> {
  const existing = await getUserOrganization(input.userId);
  if (existing) return existing;

  const name = input.organizationName?.trim() || `Negocio de ${input.fullName}`.trim();
  return db.transaction(async (tx) => {
    const [organization] = await tx
      .insert(organizations)
      .values({ name, slug: `${slugify(name)}-${randomBytes(3).toString("hex")}` })
      .returning();
    if (!organization) throw new Error("No se pudo crear la organización");

    await tx.insert(agentConfigs).values({
      organizationId: organization.id,
      systemPrompt: DEFAULT_SYSTEM_PROMPT.replace("{{negocio}}", name),
    });
    const [profile] = await tx
      .insert(profiles)
      .values({ userId: input.userId, organizationId: organization.id, fullName: input.fullName, role: "owner" })
      .returning();
    if (!profile) throw new Error("No se pudo crear el perfil");
    return { profile, organization };
  });
}

// ── 3. Webhook: phone_number_id → organización ─────────────────────────────────────────────────

export async function resolveOrganizationByPhoneNumberId(phoneNumberId: string): Promise<string | null> {
  const [row] = await db
    .select({ organizationId: whatsappConfigs.organizationId })
    .from(whatsappConfigs)
    .where(and(eq(whatsappConfigs.phoneNumberId, phoneNumberId)))
    .limit(1);
  return row?.organizationId ?? null;
}

export type WebhookConfig = { organizationId: string; appSecretEncrypted: string };

/** 5. Secreto (cifrado) con el que se firma el webhook de este número. */
export async function getWebhookConfigByPhoneNumberId(phoneNumberId: string): Promise<WebhookConfig | null> {
  const [row] = await db
    .select({ organizationId: whatsappConfigs.organizationId, appSecretEncrypted: whatsappConfigs.appSecretEncrypted })
    .from(whatsappConfigs)
    .where(eq(whatsappConfigs.phoneNumberId, phoneNumberId))
    .limit(1);
  return row ?? null;
}

/** 5. ¿Algún negocio tiene este token de verificación? (GET de suscripción del webhook). */
export async function verifyTokenExists(token: string): Promise<boolean> {
  const [row] = await db
    .select({ organizationId: whatsappConfigs.organizationId })
    .from(whatsappConfigs)
    .where(eq(whatsappConfigs.verifyToken, token))
    .limit(1);
  return Boolean(row);
}

// ── 4. Cron de reproceso ───────────────────────────────────────────────────────────────────────

export const MAX_WEBHOOK_ATTEMPTS = 5;

/**
 * Reclama eventos para reprocesar: `pending` con más de `graceSeconds` (deja margen a after()) o
 * `processing` cuyo bloqueo caducó (proceso muerto por un redeploy). SKIP LOCKED permite varias
 * instancias sin duplicar. Los que agotaron intentos pasan a `failed`.
 */
export async function claimWebhookEventsForReprocess(
  limit: number,
  opts: { graceSeconds: number; lockTimeoutSeconds: number } = { graceSeconds: 30, lockTimeoutSeconds: 300 },
): Promise<{ id: string; organizationId: string }[]> {
  await db.execute(sql`
    update webhook_events
       set status = 'failed', last_error = coalesce(last_error, 'Intentos agotados')
     where attempts >= ${MAX_WEBHOOK_ATTEMPTS}
       and (status = 'pending' or (status = 'processing' and locked_at < now() - make_interval(secs => ${opts.lockTimeoutSeconds})))`);
  const result = await db.execute<{ id: string; organization_id: string }>(sql`
    update webhook_events
       set status = 'processing', locked_at = now(), attempts = attempts + 1
     where id in (
       select id from webhook_events
        where (status = 'pending' and received_at < now() - make_interval(secs => ${opts.graceSeconds}))
           or (status = 'processing' and locked_at < now() - make_interval(secs => ${opts.lockTimeoutSeconds}))
        order by received_at
        limit ${limit}
        for update skip locked)
    returning id, organization_id`);
  return result.rows.map((r) => ({ id: r.id, organizationId: r.organization_id }));
}

/** Devuelve a `pending` los eventos reclamados que no llegaron a procesarse (no cuenta como intento). */
export async function releaseWebhookEvents(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await db.execute(sql`
    update webhook_events
       set status = 'pending', attempts = greatest(attempts - 1, 0), locked_at = null
     where status = 'processing' and id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`);
}
