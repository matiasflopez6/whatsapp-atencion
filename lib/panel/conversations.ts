import { and, desc, eq, ilike, lt, or, sql } from "drizzle-orm";
import { contacts, conversations, messages } from "@/db/schema";
import { withTenant } from "@/lib/db/tenant";
import type { ConversationDetail, ConversationFilter, ConversationSummary, MessageDto, Sender } from "./types";

export const MESSAGES_PAGE = 100;
export const CONVERSATIONS_LIMIT = 100;

const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

const lastMessage = (column: "content" | "sender") =>
  sql`(select m.${sql.raw(column)} from messages m where m.conversation_id = ${conversations.id} order by m.created_at desc limit 1)`;

const summaryColumns = {
  id: conversations.id,
  contactName: contacts.fullName,
  waPhone: contacts.waPhone,
  botActive: conversations.botActive,
  handoffReason: conversations.handoffReason,
  lastMessageAt: conversations.lastMessageAt,
  preview: sql<string | null>`${lastMessage("content")}`,
  previewSender: sql<Sender | null>`${lastMessage("sender")}`,
};

type SummaryRow = {
  id: string;
  contactName: string | null;
  waPhone: string;
  botActive: boolean | null;
  handoffReason: string | null;
  lastMessageAt: Date | null;
  preview: string | null;
  previewSender: Sender | null;
};

function toSummary(row: SummaryRow): ConversationSummary {
  return {
    id: row.id,
    contactName: row.contactName,
    waPhone: row.waPhone,
    botActive: row.botActive ?? true,
    handoffReason: row.handoffReason,
    lastMessageAt: (row.lastMessageAt ?? new Date(0)).toISOString(),
    preview: row.preview,
    previewSender: row.previewSender,
  };
}

/** Conversaciones de la organización, la más reciente primero. `attention` = el bot está apagado. */
export async function listConversations(
  organizationId: string,
  opts: { query?: string; filter?: ConversationFilter } = {},
): Promise<ConversationSummary[]> {
  const q = opts.query?.trim();
  const rows = await withTenant(organizationId, (tx) =>
    tx
      .select(summaryColumns)
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(
        and(
          opts.filter === "attention" ? eq(conversations.botActive, false) : undefined,
          opts.filter === "bot" ? eq(conversations.botActive, true) : undefined,
          q ? or(ilike(contacts.fullName, `%${escapeLike(q)}%`), ilike(contacts.waPhone, `%${escapeLike(q)}%`)) : undefined,
        ),
      )
      .orderBy(desc(conversations.lastMessageAt))
      .limit(CONVERSATIONS_LIMIT),
  );
  return rows.map(toSummary);
}

export async function getConversation(organizationId: string, id: string): Promise<ConversationDetail | null> {
  const [row] = await withTenant(organizationId, (tx) =>
    tx
      .select({
        ...summaryColumns,
        lastInboundAt: sql<Date | string | null>`(select max(m.created_at) from messages m where m.conversation_id = ${conversations.id} and m.direction = 'inbound')`,
      })
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(eq(conversations.id, id))
      .limit(1),
  );
  if (!row) return null;
  return { ...toSummary(row), lastInboundAt: row.lastInboundAt ? new Date(row.lastInboundAt).toISOString() : null };
}

/** Mensajes en orden cronológico. `before` = id del mensaje más antiguo ya cargado (paginación hacia atrás). */
export async function listMessages(
  organizationId: string,
  conversationId: string,
  opts: { before?: string; limit?: number } = {},
): Promise<{ messages: MessageDto[]; hasMore: boolean }> {
  const limit = opts.limit ?? MESSAGES_PAGE;
  const rows = await withTenant(organizationId, (tx) =>
    tx
      .select({
        id: messages.id,
        direction: messages.direction,
        sender: messages.sender,
        content: messages.content,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          // Se compara en la propia base (microsegundos) para no perder mensajes por el redondeo a ms de JS.
          opts.before ? lt(messages.createdAt, sql`(select m.created_at from messages m where m.id = ${opts.before}::uuid)`) : undefined,
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(limit + 1),
  );
  const hasMore = rows.length > limit;
  return {
    hasMore,
    messages: rows
      .slice(0, limit)
      .reverse()
      .map((m) => ({ ...m, createdAt: (m.createdAt ?? new Date(0)).toISOString() })),
  };
}
