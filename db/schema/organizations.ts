import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth";

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  timezone: text("timezone").notNull().default("America/Mexico_City"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// Extiende "user" de Better Auth y lo vincula a una organización.
export const profiles = pgTable(
  "profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    fullName: text("full_name"),
    role: text("role", { enum: ["owner", "staff"] }).default("owner"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    check("profiles_role_check", sql`${t.role} in ('owner','staff')`),
    index("profiles_org_idx").on(t.organizationId),
  ],
);
