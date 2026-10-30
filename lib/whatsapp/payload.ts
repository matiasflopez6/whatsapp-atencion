import { z } from "zod";

/**
 * Payload del webhook de WhatsApp Cloud API (solo lo que usamos; el resto se conserva en `raw`).
 * Un POST puede traer varias `entry[].changes[]`, cada una con varios mensajes.
 */
const messageSchema = z
  .object({
    id: z.string(),
    from: z.string(),
    timestamp: z.string().optional(),
    type: z.string(),
    text: z.object({ body: z.string() }).optional(),
    button: z.object({ text: z.string() }).optional(),
    interactive: z
      .object({
        button_reply: z.object({ title: z.string() }).optional(),
        list_reply: z.object({ title: z.string() }).optional(),
      })
      .optional(),
  })
  .loose();

const valueSchema = z
  .object({
    metadata: z.object({ phone_number_id: z.string() }).loose(),
    contacts: z.array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string().optional() }).optional() }).loose()).optional(),
    messages: z.array(messageSchema).optional(),
    statuses: z.array(z.unknown()).optional(),
  })
  .loose();

export const webhookPayloadSchema = z
  .object({
    object: z.string().optional(),
    entry: z.array(z.object({ changes: z.array(z.object({ field: z.string().optional(), value: valueSchema }).loose()).default([]) }).loose()),
  })
  .loose();

export type InboundMessage = z.infer<typeof messageSchema>;

/** Un mensaje entrante ya aislado, tal como se persiste en `webhook_events.payload`. */
export type InboundEventPayload = {
  phoneNumberId: string;
  contactName: string | null;
  message: InboundMessage;
};

export function extractInbound(payload: z.infer<typeof webhookPayloadSchema>): InboundEventPayload[] {
  const out: InboundEventPayload[] = [];
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      const { value } = change;
      for (const message of value.messages ?? []) {
        const profile = value.contacts?.find((c) => c.wa_id === message.from)?.profile;
        out.push({ phoneNumberId: value.metadata.phone_number_id, contactName: profile?.name ?? null, message });
      }
    }
  }
  return out;
}

export function phoneNumberIds(payload: z.infer<typeof webhookPayloadSchema>): string[] {
  const ids = new Set<string>();
  for (const entry of payload.entry) for (const change of entry.changes) ids.add(change.value.metadata.phone_number_id);
  return [...ids];
}

/** Texto legible del mensaje. Los tipos no textuales llegan como marcador para que el agente pida texto. */
export function messageText(message: InboundMessage): string {
  if (message.type === "text" && message.text) return message.text.body;
  if (message.type === "button" && message.button) return message.button.text;
  if (message.type === "interactive") {
    const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;
    if (reply) return reply.title;
  }
  return `[El cliente envió un mensaje de tipo "${message.type}" que no se puede leer]`;
}

/** wa_id llega sin "+": se normaliza a E.164. */
export function toE164(waId: string): string {
  return waId.startsWith("+") ? waId : `+${waId}`;
}
