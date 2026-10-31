import { decrypt } from "@/lib/crypto";
import { webhookEvents } from "@/db/schema";
import { getWebhookConfigByPhoneNumberId } from "@/lib/db/system";
import { withTenant } from "@/lib/db/tenant";
import { log } from "@/lib/logger";
import { extractInbound, phoneNumberIds, webhookPayloadSchema } from "./payload";
import { verifySignature } from "./signature";
import type { EventRef } from "./process";

export type IngestResult =
  | { status: 200; events: EventRef[] }
  | { status: 400 | 401; error: string };

/**
 * Valida y persiste un POST de Meta. La firma se comprueba con el App Secret de la organización dueña
 * de cada `phone_number_id` (el body ya está leído como texto crudo). Si algo falla al guardar, se lanza
 * (→ 500) para que Meta reintente; los duplicados (mismo message.id) se descartan en silencio.
 */
export async function ingestWebhook(rawBody: string, signature: string | null): Promise<IngestResult> {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { status: 400, error: "JSON inválido" };
  }
  const parsed = webhookPayloadSchema.safeParse(json);
  if (!parsed.success) return { status: 400, error: "Payload no reconocido" };

  const organizations = new Map<string, string>(); // phone_number_id → organización verificada
  for (const phoneNumberId of phoneNumberIds(parsed.data)) {
    const config = await getWebhookConfigByPhoneNumberId(phoneNumberId);
    if (!config) {
      log.warn("webhook para un número sin configurar", { phoneNumberId });
      continue;
    }
    if (!verifySignature(rawBody, signature, decrypt(config.appSecretEncrypted))) {
      log.warn("firma de webhook inválida", { organizationId: config.organizationId, phoneNumberId });
      return { status: 401, error: "Firma inválida" };
    }
    organizations.set(phoneNumberId, config.organizationId);
  }

  const events: EventRef[] = [];
  const inbound = extractInbound(parsed.data);
  for (const item of inbound) {
    const organizationId = organizations.get(item.phoneNumberId);
    if (!organizationId) continue;
    const [row] = await withTenant(organizationId, (tx) =>
      tx
        .insert(webhookEvents)
        .values({ organizationId, waMessageId: item.message.id, payload: item })
        .onConflictDoNothing({ target: webhookEvents.waMessageId })
        .returning({ id: webhookEvents.id }),
    );
    if (row) events.push({ id: row.id, organizationId });
    else log.info("webhook duplicado descartado", { organizationId, waMessageId: item.message.id });
  }
  log.info("webhook recibido", { messages: inbound.length, accepted: events.length });
  return { status: 200, events };
}
