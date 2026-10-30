import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { contacts } from "./conversations";
import { organizations } from "./organizations";

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    service: text("service").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    googleEventId: text("google_event_id"),
    status: text("status", { enum: ["confirmed", "cancelled", "completed"] }).default("confirmed"),
    isNewPatient: boolean("is_new_patient"),
    fullName: text("full_name").notNull(),
    phone: text("phone").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("appointments_org_starts_idx").on(t.organizationId, t.startsAt),
    index("appointments_contact_idx").on(t.contactId),
    check("appointments_status_check", sql`${t.status} in ('confirmed','cancelled','completed')`),
  ],
);
