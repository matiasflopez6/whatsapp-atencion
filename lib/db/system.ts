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
 *   4. (hilo del cron) leer/reclamar webhook_events pendientes antes de entrar a withTenant().
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
