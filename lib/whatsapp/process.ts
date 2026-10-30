import { and, eq, sql } from "drizzle-orm";
import { agentConfigs, contacts, conversations, messages, webhookEvents } from "@/db/schema";
import { runAgent, type AgentDeps } from "@/lib/agent/run";
import { withTenant } from "@/lib/db/tenant";
import { MAX_WEBHOOK_ATTEMPTS } from "@/lib/db/system";
import { errorMessage, log, maskPhone } from "@/lib/logger";
import { withLock } from "@/lib/mutex";
import { markAsReadWithTyping, sendWhatsAppMessage } from "./client";
import { messageText, toE164, type InboundEventPayload } from "./payload";

export type EventRef = { id: string; organizationId: string };

export type ProcessDeps = AgentDeps & {
  send?: typeof sendWhatsAppMessage;
};

/** Reclama un evento `pending` (after() tras responder 200). Devuelve false si otro proceso ya lo tomó. */
async function claim(ref: EventRef): Promise<boolean> {
  const rows = await withTenant(ref.organizationId, (tx) =>
    tx
      .update(webhookEvents)
      .set({ status: "processing", lockedAt: new Date(), attempts: sql`${webhookEvents.attempts} + 1` })
      .where(and(eq(webhookEvents.id, ref.id), eq(webhookEvents.status, "pending")))
      .returning({ id: webhookEvents.id }),
  );
  return rows.length > 0;
}

/**
 * Procesa un evento del inbox. `alreadyClaimed` = el cron ya lo marcó `processing` (y sumó el intento).
 * Nunca lanza: el resultado queda en `webhook_events.status` (done / pending para reintento / failed).
 */
export async function processWebhookEvent(ref: EventRef, opts: { alreadyClaimed?: boolean } = {}, deps: ProcessDeps = {}): Promise<void> {
  const { organizationId, id } = ref;
  if (!opts.alreadyClaimed && !(await claim(ref))) return;

  const [event] = await withTenant(organizationId, (tx) => tx.select().from(webhookEvents).where(eq(webhookEvents.id, id)).limit(1));
  if (!event) return;
  const payload = event.payload as InboundEventPayload;
  const started = Date.now();

  try {
    await handleInbound(organizationId, payload, deps);
    await withTenant(organizationId, (tx) =>
      tx.update(webhookEvents).set({ status: "done", processedAt: new Date(), lastError: null }).where(eq(webhookEvents.id, id)),
    );
    log.info("webhook procesado", { organizationId, eventId: id, waMessageId: event.waMessageId, attempts: event.attempts, ms: Date.now() - started });
  } catch (error) {
    const exhausted = event.attempts >= MAX_WEBHOOK_ATTEMPTS;
    log.error("webhook falló", { organizationId, eventId: id, attempts: event.attempts, exhausted, error: errorMessage(error) });
    await withTenant(organizationId, (tx) =>
      tx
        .update(webhookEvents)
        .set({ status: exhausted ? "failed" : "pending", lastError: errorMessage(error).slice(0, 1000) })
        .where(eq(webhookEvents.id, id)),
    );
    if (exhausted) await handOffAfterFailure(organizationId, payload, deps).catch(() => undefined);
  }
}

/** Posterior al mensaje dado, comparando en la propia base (microsegundos; evita el redondeo a ms de JS). */
const newerThan = (messageId: string) =>
  sql`${messages.createdAt} > (select created_at from messages where id = ${messageId}::uuid)`;

type Stored = { conversationId: string; contactId: string; messageId: string; botActive: boolean };

async function storeInbound(organizationId: string, payload: InboundEventPayload): Promise<Stored> {
  const waPhone = toE164(payload.message.from);
  // Serializa el alta de contacto/conversación del mismo número (no hay UNIQUE sobre conversations.contact_id).
  return withLock(`init:${organizationId}:${waPhone}`, () =>
    withTenant(organizationId, async (tx) => {
      const [contact] = await tx
        .insert(contacts)
        .values({ organizationId, waPhone, fullName: payload.contactName })
        .onConflictDoUpdate({
          target: [contacts.organizationId, contacts.waPhone],
          set: { fullName: sql`coalesce(${contacts.fullName}, excluded.full_name)` },
        })
        .returning();
      if (!contact) throw new Error("No se pudo guardar el contacto");

      let [conversation] = await tx.select().from(conversations).where(eq(conversations.contactId, contact.id)).limit(1);
      if (!conversation) {
        [conversation] = await tx.insert(conversations).values({ organizationId, contactId: contact.id }).returning();
      }
      if (!conversation) throw new Error("No se pudo guardar la conversación");

      const inserted = await tx
        .insert(messages)
        .values({
          conversationId: conversation.id,
          organizationId,
          waMessageId: payload.message.id,
          direction: "inbound",
          sender: "contact",
          content: messageText(payload.message),
          raw: payload.message,
        })
        .onConflictDoNothing({ target: messages.waMessageId })
        .returning();
      const message =
        inserted[0] ?? (await tx.select().from(messages).where(eq(messages.waMessageId, payload.message.id)).limit(1))[0];
      if (!message) throw new Error("No se pudo guardar el mensaje");

      if (inserted[0]) {
        await tx.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, conversation.id));
      }
      return {
        conversationId: conversation.id,
        contactId: contact.id,
        messageId: message.id,
        botActive: conversation.botActive ?? true,
      };
    }),
  );
}

async function handleInbound(organizationId: string, payload: InboundEventPayload, deps: ProcessDeps): Promise<void> {
  const stored = await storeInbound(organizationId, payload);
  const logCtx = { organizationId, conversationId: stored.conversationId, phone: maskPhone(payload.message.from) };
  void markAsReadWithTyping(organizationId, payload.message.id);

  // Un hilo de ejecución del agente por conversación; los mensajes seguidos se responden en orden.
  await withLock(`conversation:${stored.conversationId}`, async () => {
    const state = await withTenant(organizationId, async (tx) => {
      const [conversation] = await tx.select().from(conversations).where(eq(conversations.id, stored.conversationId)).limit(1);
      const [answered] = await tx
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.conversationId, stored.conversationId), sql`${messages.raw}->>'inReplyTo' = ${stored.messageId}`))
        .limit(1);
      const [newer] = await tx
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.conversationId, stored.conversationId), eq(messages.direction, "inbound"), newerThan(stored.messageId)))
        .limit(1);
      return { botActive: conversation?.botActive ?? true, answered: Boolean(answered), newer: Boolean(newer) };
    });
    if (!state.botActive) return log.info("bot apagado en la conversación: no se responde", logCtx);
    // Ya respondido (reintento tras un fallo parcial, o una persona contestó): no se duplica la respuesta.
    if (state.answered) return log.info("mensaje ya respondido", logCtx);
    // Hay un mensaje más nuevo: su turno (que espera en este mismo candado) responderá con todo el contexto.
    if (state.newer) return log.info("hay un mensaje más nuevo: lo responde su turno", logCtx);

    const result = await runAgent({ organizationId, conversationId: stored.conversationId, contactId: stored.contactId }, deps);

    // Si entró un mensaje más nuevo mientras el agente pensaba, su turno responderá con todo el contexto,
    // salvo que este turno ya haya agendado o traspasado (esos efectos exigen decírselo al cliente).
    const stale = await withTenant(organizationId, async (tx) => {
      const [conversation] = await tx.select({ botActive: conversations.botActive }).from(conversations).where(eq(conversations.id, stored.conversationId)).limit(1);
      const [newer] = await tx
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.conversationId, stored.conversationId), eq(messages.direction, "inbound"), newerThan(stored.messageId)))
        .limit(1);
      return { humanTookOver: conversation?.botActive === false && !result.handoff, newer: Boolean(newer) };
    });
    if (stale.humanTookOver) return log.info("una persona tomó la conversación: se descarta la respuesta", logCtx);
    if (stale.newer && !result.booked && !result.handoff) return log.info("llegó otro mensaje: se descarta esta respuesta", logCtx);

    let text = result.text;
    if (!text && result.handoff) {
      const [config] = await withTenant(organizationId, (tx) => tx.select({ m: agentConfigs.handoffMessage }).from(agentConfigs).where(eq(agentConfigs.organizationId, organizationId)).limit(1));
      text = config?.m ?? "Te paso con una persona del equipo en un momento.";
    }
    if (!text) throw new Error("El agente no generó respuesta");

    await sendAndStore(organizationId, stored, payload, text, deps, stored.messageId);
  });
}

async function sendAndStore(
  organizationId: string,
  stored: Pick<Stored, "conversationId">,
  payload: InboundEventPayload,
  text: string,
  deps: ProcessDeps,
  inReplyTo?: string,
): Promise<void> {
  const { waMessageId } = await (deps.send ?? sendWhatsAppMessage)({ organizationId, to: toE164(payload.message.from), body: text });
  await withTenant(organizationId, async (tx) => {
    await tx.insert(messages).values({
      conversationId: stored.conversationId,
      organizationId,
      waMessageId,
      direction: "outbound",
      sender: "bot",
      content: text,
      // Marca a qué mensaje responde: permite reintentos idempotentes sin duplicar la respuesta.
      raw: inReplyTo ? { inReplyTo } : null,
    });
    await tx.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, stored.conversationId));
  });
}

/** Último recurso tras agotar reintentos: apaga el bot y avisa al cliente para que una persona retome. */
async function handOffAfterFailure(organizationId: string, payload: InboundEventPayload, deps: ProcessDeps): Promise<void> {
  const waPhone = toE164(payload.message.from);
  const found = await withTenant(organizationId, async (tx) => {
    const [row] = await tx
      .select({ conversationId: conversations.id, handoff: agentConfigs.handoffMessage })
      .from(contacts)
      .innerJoin(conversations, eq(conversations.contactId, contacts.id))
      .innerJoin(agentConfigs, eq(agentConfigs.organizationId, contacts.organizationId))
      .where(eq(contacts.waPhone, waPhone))
      .limit(1);
    if (row) {
      await tx
        .update(conversations)
        .set({ botActive: false, handoffReason: "El agente no pudo responder (error técnico)" })
        .where(eq(conversations.id, row.conversationId));
    }
    return row;
  });
  if (found) await sendAndStore(organizationId, found, payload, found.handoff ?? "Te paso con una persona del equipo en un momento.", deps);
}
