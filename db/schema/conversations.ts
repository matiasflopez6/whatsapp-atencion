import { sql } from "drizzle-orm";
import { boolean, check, index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    waPhone: text("wa_phone").notNull(), // E.164, ej. +5218112345678
    fullName: text("full_name"),
    isNewPatient: boolean("is_new_patient"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [unique("contacts_org_phone_unique").on(t.organizationId, t.waPhone)],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    botActive: boolean("bot_active").default(true), // toggle de handoff humano
    handoffReason: text("handoff_reason"), // por qué el bot cedió la conversación (null si sigue activo)
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("conversations_org_last_message_idx").on(t.organizationId, t.lastMessageAt.desc()),
    index("conversations_contact_idx").on(t.contactId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    waMessageId: text("wa_message_id").unique(), // id de Meta, para idempotencia
    direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
    sender: text("sender", { enum: ["contact", "bot", "human"] }).notNull(),
    content: text("content"),
    raw: jsonb("raw"), // payload original de Meta
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("messages_conversation_created_idx").on(t.conversationId, t.createdAt.desc()),
    check("messages_direction_check", sql`${t.direction} in ('inbound','outbound')`),
    check("messages_sender_check", sql`${t.sender} in ('contact','bot','human')`),
  ],
);
