import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

// Todos los tokens/secretos se guardan cifrados (AES-256-GCM, lib/crypto.ts).
export const whatsappConfigs = pgTable("whatsapp_configs", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  // Único: resuelve la organización en el webhook.
  phoneNumberId: text("phone_number_id").notNull().unique(),
  wabaId: text("waba_id").notNull(),
  accessTokenEncrypted: text("access_token_encrypted").notNull(),
  verifyToken: text("verify_token").notNull(),
  appSecretEncrypted: text("app_secret_encrypted").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const googleCalendarConfigs = pgTable("google_calendar_configs", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  calendarId: text("calendar_id").notNull(),
  refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
  accessTokenEncrypted: text("access_token_encrypted"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  accountEmail: text("account_email"),
  // "disconnected" cuando Google responde invalid_grant (token revocado/caducado): el agente no ofrece horarios.
  status: text("status", { enum: ["connected", "disconnected"] }).notNull().default("connected"),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
