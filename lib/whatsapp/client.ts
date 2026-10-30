import { eq } from "drizzle-orm";
import { whatsappConfigs } from "@/db/schema";
import { decrypt } from "@/lib/crypto";
import { withTenant } from "@/lib/db/tenant";
import { log } from "@/lib/logger";
import { GRAPH_API_BASE, WHATSAPP_MAX_TEXT } from "./constants";

export class WhatsAppApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
  ) {
    super(message);
    this.name = "WhatsAppApiError";
  }
}

type GraphError = { error?: { message?: string; code?: number } };

async function graph<T>(path: string, accessToken: string, init?: { method: "POST"; body: unknown }): Promise<T> {
  const response = await fetch(`${GRAPH_API_BASE}/${path}`, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: init ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await response.json().catch(() => ({}))) as T & GraphError;
  if (!response.ok) {
    throw new WhatsAppApiError(json.error?.message ?? `Graph API respondió ${response.status}`, response.status, json.error?.code);
  }
  return json;
}

export type WhatsAppCredentials = { phoneNumberId: string; accessToken: string };

async function loadCredentials(organizationId: string): Promise<WhatsAppCredentials> {
  const [row] = await withTenant(organizationId, (tx) =>
    tx
      .select({ phoneNumberId: whatsappConfigs.phoneNumberId, token: whatsappConfigs.accessTokenEncrypted })
      .from(whatsappConfigs)
      .where(eq(whatsappConfigs.organizationId, organizationId))
      .limit(1),
  );
  if (!row) throw new Error("La organización no tiene WhatsApp configurado");
  return { phoneNumberId: row.phoneNumberId, accessToken: decrypt(row.token) };
}

/** Envía un mensaje de texto libre (dentro de la ventana de 24 h). Devuelve el id de Meta. */
export async function sendWhatsAppMessage(input: {
  organizationId: string;
  to: string;
  body: string;
}): Promise<{ waMessageId: string }> {
  const { phoneNumberId, accessToken } = await loadCredentials(input.organizationId);
  const result = await graph<{ messages?: { id: string }[] }>(`${phoneNumberId}/messages`, accessToken, {
    method: "POST",
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.to.replace(/^\+/, ""),
      type: "text",
      text: { preview_url: false, body: input.body.slice(0, WHATSAPP_MAX_TEXT) },
    },
  });
  const waMessageId = result.messages?.[0]?.id;
  if (!waMessageId) throw new WhatsAppApiError("Meta no devolvió el id del mensaje", 502);
  return { waMessageId };
}

/** Marca como leído y muestra «escribiendo…» (se apaga al responder o a los ~25 s). Nunca lanza. */
export async function markAsReadWithTyping(organizationId: string, waMessageId: string): Promise<void> {
  try {
    const { phoneNumberId, accessToken } = await loadCredentials(organizationId);
    await graph(`${phoneNumberId}/messages`, accessToken, {
      method: "POST",
      body: { messaging_product: "whatsapp", status: "read", message_id: waMessageId, typing_indicator: { type: "text" } },
    });
  } catch (error) {
    log.warn("whatsapp mark-as-read falló", { organizationId, error: error instanceof Error ? error.message : String(error) });
  }
}

export type ConnectionTest =
  | { ok: true; displayPhoneNumber: string; verifiedName: string }
  | { ok: false; error: string };

/** Comprueba que el token pertenece a ese número (GET /{phone_number_id}). */
export async function testWhatsAppConnection(creds: WhatsAppCredentials): Promise<ConnectionTest> {
  try {
    const info = await graph<{ display_phone_number?: string; verified_name?: string }>(
      `${creds.phoneNumberId}?fields=display_phone_number,verified_name`,
      creds.accessToken,
    );
    return { ok: true, displayPhoneNumber: info.display_phone_number ?? "", verifiedName: info.verified_name ?? "" };
  } catch (error) {
    if (error instanceof WhatsAppApiError) {
      if (error.code === 190) return { ok: false, error: "El token de acceso no es válido o ha caducado." };
      if (error.status === 400 || error.status === 404) return { ok: false, error: `Meta rechazó el Phone number ID o el token: ${error.message}` };
      return { ok: false, error: error.message };
    }
    return { ok: false, error: "No se pudo contactar con Meta. Inténtalo de nuevo." };
  }
}

export async function testStoredConnection(organizationId: string): Promise<ConnectionTest> {
  try {
    return await testWhatsAppConnection(await loadCredentials(organizationId));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Error desconocido" };
  }
}
