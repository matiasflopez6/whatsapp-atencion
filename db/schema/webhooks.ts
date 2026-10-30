import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

// Bandeja de entrada persistida del webhook de WhatsApp (sustituye a una cola gestionada).
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    waMessageId: text("wa_message_id").unique(), // idempotencia: Meta puede reenviar el mismo evento
    payload: jsonb("payload").notNull(), // payload crudo ya verificado con HMAC
    status: text("status", { enum: ["pending", "processing", "done", "failed"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    index("webhook_events_status_received_idx").on(t.status, t.receivedAt),
    check("webhook_events_status_check", sql`${t.status} in ('pending','processing','done','failed')`),
  ],
);
