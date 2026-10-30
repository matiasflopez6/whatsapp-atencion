"use server";

import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { googleCalendarConfigs, whatsappConfigs } from "@/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";
import { withTenant } from "@/lib/db/tenant";
import { listCalendars } from "@/lib/google/calendar";
import { revokeToken } from "@/lib/google/oauth";
import { errorMessage, log } from "@/lib/logger";
import { requireSession } from "@/lib/session";
import { testStoredConnection, testWhatsAppConnection } from "@/lib/whatsapp/client";

/** `fields` devuelve lo escrito (sin secretos) porque React vacía el formulario tras cada acción. */
export type ActionState = { ok?: string; error?: string; fields?: { phoneNumberId: string; wabaId: string } };

const digits = (label: string) => z.string().trim().regex(/^\d{5,25}$/, `${label}: solo números`);

const whatsappSchema = z.object({
  phoneNumberId: digits("Phone number ID"),
  wabaId: digits("WhatsApp Business Account ID"),
  accessToken: z.string().trim().max(1000).optional(),
  appSecret: z.string().trim().max(200).optional(),
});

const connectionMessage = (name: string, number: string) => `Conexión verificada${name ? `: ${name}` : ""}${number ? ` (${number})` : ""}.`;

/** Guarda las credenciales de WhatsApp (cifradas) tras comprobarlas contra Meta. Los secretos vacíos conservan los guardados. */
export async function saveWhatsappAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId, organization } = await requireSession();
  const input = Object.fromEntries(formData) as Record<string, string>;
  const fields = { phoneNumberId: input.phoneNumberId ?? "", wabaId: input.wabaId ?? "" };
  const parsed = whatsappSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos", fields };
  const { phoneNumberId, wabaId } = parsed.data;
  const accessToken = parsed.data.accessToken || undefined;
  const appSecret = parsed.data.appSecret || undefined;

  const [existing] = await withTenant(organizationId, (tx) =>
    tx.select().from(whatsappConfigs).where(eq(whatsappConfigs.organizationId, organizationId)).limit(1),
  );
  if (!existing && (!accessToken || !appSecret)) return { error: "Indica el token de acceso y el App Secret.", fields };

  const tokenToTest = accessToken ?? (existing ? decrypt(existing.accessTokenEncrypted) : "");
  const test = await testWhatsAppConnection({ phoneNumberId, accessToken: tokenToTest });
  if (!test.ok) return { error: test.error, fields };

  try {
    await withTenant(organizationId, (tx) =>
      tx
        .insert(whatsappConfigs)
        .values({
          organizationId,
          phoneNumberId,
          wabaId,
          accessTokenEncrypted: encrypt(tokenToTest),
          appSecretEncrypted: existing && !appSecret ? existing.appSecretEncrypted : encrypt(appSecret ?? ""),
          // `{slug}:{secreto}`: el token identifica el negocio en la verificación del webhook.
          verifyToken: existing?.verifyToken ?? `${organization.slug}:${randomBytes(24).toString("base64url")}`,
        })
        .onConflictDoUpdate({
          target: whatsappConfigs.organizationId,
          set: {
            phoneNumberId,
            wabaId,
            accessTokenEncrypted: encrypt(tokenToTest),
            ...(appSecret ? { appSecretEncrypted: encrypt(appSecret) } : {}),
            updatedAt: new Date(),
          },
        }),
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505" || /unique/i.test(errorMessage(error))) {
      return { error: "Ese Phone number ID ya está conectado a otro negocio.", fields };
    }
    log.error("no se pudo guardar whatsapp_configs", { organizationId, error: errorMessage(error) });
    return { error: "No se pudo guardar la configuración. Inténtalo de nuevo.", fields };
  }
  revalidatePath("/integraciones");
  return { ok: `Guardado. ${connectionMessage(test.verifiedName, test.displayPhoneNumber)}` };
}

export async function testWhatsappAction(): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const test = await testStoredConnection(organizationId);
  return test.ok ? { ok: connectionMessage(test.verifiedName, test.displayPhoneNumber) } : { error: test.error };
}

export async function disconnectWhatsappAction(): Promise<void> {
  const { organizationId } = await requireSession();
  await withTenant(organizationId, (tx) => tx.delete(whatsappConfigs).where(eq(whatsappConfigs.organizationId, organizationId)));
  revalidatePath("/integraciones");
}

export async function disconnectGoogleAction(): Promise<void> {
  const { organizationId } = await requireSession();
  const [row] = await withTenant(organizationId, (tx) =>
    tx.delete(googleCalendarConfigs).where(eq(googleCalendarConfigs.organizationId, organizationId)).returning(),
  );
  if (row) {
    try {
      await revokeToken(decrypt(row.refreshTokenEncrypted));
    } catch {
      // Revocar es mejor esfuerzo: la fila ya se borró.
    }
  }
  revalidatePath("/integraciones");
}

/** El calendario elegido debe pertenecer a la cuenta conectada (se valida contra la lista real de Google). */
export async function saveCalendarAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const calendarId = String(formData.get("calendarId") ?? "");
  try {
    const calendars = await listCalendars(organizationId);
    if (!calendars.some((c) => c.id === calendarId)) return { error: "Ese calendario no está disponible en tu cuenta." };
    await withTenant(organizationId, (tx) =>
      tx.update(googleCalendarConfigs).set({ calendarId, updatedAt: new Date() }).where(eq(googleCalendarConfigs.organizationId, organizationId)),
    );
  } catch (error) {
    return { error: errorMessage(error) };
  }
  revalidatePath("/integraciones");
  return { ok: "Calendario guardado." };
}
