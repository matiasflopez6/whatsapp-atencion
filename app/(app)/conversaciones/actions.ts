"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { conversations, messages } from "@/db/schema";
import { withTenant } from "@/lib/db/tenant";
import { errorMessage, log } from "@/lib/logger";
import { getConversation } from "@/lib/panel/conversations";
import { replyWindowOpen } from "@/lib/panel/reply-window";
import type { MessageDto } from "@/lib/panel/types";
import { requireSession } from "@/lib/session";
import { WHATSAPP_MAX_TEXT } from "@/lib/whatsapp/constants";
import { sendWhatsAppMessage } from "@/lib/whatsapp/client";

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const idSchema = z.uuid();
const MANUAL_OFF_REASON = "Apagado manualmente";
const HUMAN_REPLY_REASON = "Respondió una persona";

/** Enciende o apaga el bot en una conversación. Mientras está apagado el agente no responde. */
export async function setBotActiveAction(conversationId: string, active: boolean): Promise<ActionResult> {
  const { organizationId } = await requireSession();
  if (!idSchema.safeParse(conversationId).success) return { ok: false, error: "Conversación no válida" };
  const updated = await withTenant(organizationId, (tx) =>
    tx
      .update(conversations)
      .set({ botActive: active, handoffReason: active ? null : MANUAL_OFF_REASON })
      .where(eq(conversations.id, conversationId))
      .returning({ id: conversations.id }),
  );
  if (!updated.length) return { ok: false, error: "No se encontró la conversación" };
  log.info("bot de la conversación cambiado desde el panel", { organizationId, conversationId, active });
  return { ok: true };
}

/**
 * Respuesta del dueño por WhatsApp. Si el bot estaba activo se apaga ANTES de enviar (así el agente
 * descarta cualquier respuesta en curso) y se restaura si el envío falla. El mensaje solo se guarda
 * si Meta lo aceptó.
 */
export async function sendHumanMessageAction(conversationId: string, text: string): Promise<ActionResult<{ message: MessageDto }>> {
  const { organizationId } = await requireSession();
  const body = text.trim();
  if (!idSchema.safeParse(conversationId).success) return { ok: false, error: "Conversación no válida" };
  if (!body) return { ok: false, error: "Escribe un mensaje" };
  if (body.length > WHATSAPP_MAX_TEXT) return { ok: false, error: `El mensaje supera los ${WHATSAPP_MAX_TEXT} caracteres de WhatsApp` };

  const conversation = await getConversation(organizationId, conversationId);
  if (!conversation) return { ok: false, error: "No se encontró la conversación" };
  if (!replyWindowOpen(conversation.lastInboundAt)) {
    return {
      ok: false,
      error: "Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp solo permite plantillas aprobadas fuera de esa ventana.",
    };
  }

  const turnedOff = conversation.botActive;
  if (turnedOff) {
    await withTenant(organizationId, (tx) =>
      tx.update(conversations).set({ botActive: false, handoffReason: HUMAN_REPLY_REASON }).where(eq(conversations.id, conversationId)),
    );
  }

  try {
    const { waMessageId } = await sendWhatsAppMessage({ organizationId, to: conversation.waPhone, body });
    const message = await withTenant(organizationId, async (tx) => {
      const [row] = await tx
        .insert(messages)
        .values({ conversationId, organizationId, waMessageId, direction: "outbound", sender: "human", content: body })
        .returning();
      await tx.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, conversationId));
      return row;
    });
    if (!message) throw new Error("No se pudo guardar el mensaje enviado");
    return {
      ok: true,
      message: {
        id: message.id,
        direction: "outbound",
        sender: "human",
        content: message.content,
        createdAt: (message.createdAt ?? new Date()).toISOString(),
      },
    };
  } catch (error) {
    log.error("falló la respuesta humana", { organizationId, conversationId, error: errorMessage(error) });
    if (turnedOff) {
      await withTenant(organizationId, (tx) =>
        tx.update(conversations).set({ botActive: true, handoffReason: null }).where(eq(conversations.id, conversationId)),
      ).catch(() => undefined);
    }
    return { ok: false, error: `No se pudo enviar el mensaje: ${friendlyError(error)}` };
  }
}

function friendlyError(error: unknown): string {
  const message = errorMessage(error);
  if (message.includes("no tiene WhatsApp configurado")) return "conecta WhatsApp en Integraciones.";
  return message;
}

